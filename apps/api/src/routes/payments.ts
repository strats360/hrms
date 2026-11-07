import { Hono, type Context } from "hono";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { companyBankAccounts, employees, paymentBatches, payments, payrollItems, payrollRuns, reimbursementClaims, tenants } from "@hrms/db";
import {
  bankAccountSchema,
  batchCreateSchema,
  BANK_FORMAT_LABEL,
  buildBankFile,
  bulkPaymentUpdateSchema,
  can,
  decryptField,
  encryptField,
  inr,
  parseBankResponse,
  paymentUpdateSchema,
  todayIST,
  type BankFileFormat,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { layout } from "../lib/email";
import { toXlsx, XLSX_MIME } from "../lib/xlsx";
import { monthLabel } from "../lib/months";
import {
  activeBatchForRun,
  applyPaymentEffects,
  bankInfo,
  bonusLines,
  canTransition,
  completeSalaryRun,
  duplicateAccounts,
  loadAccount,
  missingBank,
  nextBatchCode,
  referenceAllocator,
  refreshBatch,
  reimbursementLines,
  salaryLines,
  type Batch,
  type DraftLine,
  type Payment,
} from "../services/payments";

export const paymentRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;

// ---------------------------------------------------------------------------
// Company bank accounts
// ---------------------------------------------------------------------------
const accountView = (a: typeof companyBankAccounts.$inferSelect) => {
  const { accountNumberEnc: _enc, ...rest } = a;
  return { ...rest, formatLabel: BANK_FORMAT_LABEL[a.fileFormat as BankFileFormat] ?? a.fileFormat };
};

paymentRoutes.get("/accounts", requirePerm("payments", "view"), async (c) => {
  const rows = await c.get("db").select().from(companyBankAccounts).where(eq(companyBankAccounts.tenantId, tid(c))).orderBy(desc(companyBankAccounts.isDefault), asc(companyBankAccounts.label));
  return c.json(rows.map(accountView));
});

async function clearDefault(c: Context<AppEnv>, except?: string) {
  const conds = [eq(companyBankAccounts.tenantId, tid(c))];
  if (except) conds.push(ne(companyBankAccounts.id, except));
  await c.get("db").update(companyBankAccounts).set({ isDefault: false }).where(and(...conds));
}

paymentRoutes.post("/accounts", requirePerm("payments", "configure"), v("json", bankAccountSchema), async (c) => {
  const b = c.req.valid("json");
  if (!b.accountNumber) throw badRequest("Enter the account number");
  const { accountNumber, ...rest } = b;
  const [row] = await c
    .get("db")
    .insert(companyBankAccounts)
    .values({ ...rest, tenantId: tid(c), accountNumberEnc: await encryptField(accountNumber, c.env.ENCRYPTION_KEY), accountLast4: accountNumber.slice(-4) })
    .returning();
  if (b.isDefault) await clearDefault(c, row!.id);
  await audit(c, { action: "payments.account_create", entity: "bank_account", entityId: row!.id, summary: `Added debit account ${b.bankName} ····${accountNumber.slice(-4)}` });
  return c.json(accountView(row!), 201);
});

paymentRoutes.patch("/accounts/:id", requirePerm("payments", "configure"), vPatch(bankAccountSchema.partial()), async (c) => {
  const b = c.req.valid("json");
  const { accountNumber, ...rest } = b;
  const patch: Partial<typeof companyBankAccounts.$inferInsert> = { ...rest };
  if (accountNumber) {
    patch.accountNumberEnc = await encryptField(accountNumber, c.env.ENCRYPTION_KEY);
    patch.accountLast4 = accountNumber.slice(-4);
  }
  const [row] = await c.get("db").update(companyBankAccounts).set(patch).where(and(eq(companyBankAccounts.id, c.req.param("id")), eq(companyBankAccounts.tenantId, tid(c)))).returning();
  if (!row) throw notFound("Bank account");
  if (b.isDefault) await clearDefault(c, row.id);
  await audit(c, { action: "payments.account_update", entity: "bank_account", entityId: row.id, summary: `Updated debit account ${row.bankName} ····${row.accountLast4}${accountNumber ? " (account number changed)" : ""}`, data: { ...rest } });
  return c.json(accountView(row));
});

// ---------------------------------------------------------------------------
// Summary, batches
// ---------------------------------------------------------------------------
paymentRoutes.get("/summary", requirePerm("payments", "view"), async (c) => {
  const db = c.get("db");
  const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), eq(payrollRuns.status, "approved"))).orderBy(desc(payrollRuns.month));
  const ready = [];
  for (const r of runs) {
    if (await activeBatchForRun(db, r.id)) continue;
    const [t] = await db
      .select({ n: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${payrollItems.net}),0)::float` })
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, r.id), eq(payrollItems.onHold, false), sql`${payrollItems.net} > 0`));
    ready.push({ runId: r.id, month: r.month, label: `${monthLabel(r.month)} salary`, net: t?.s ?? 0, employees: t?.n ?? 0 });
  }
  const [claims] = await db
    .select({ n: sql<number>`count(distinct ${reimbursementClaims.employeeId})::int`, c: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${reimbursementClaims.amount}),0)::float` })
    .from(reimbursementClaims)
    .where(and(eq(reimbursementClaims.tenantId, tid(c)), eq(reimbursementClaims.status, "approved"), isNull(reimbursementClaims.payrollRunId), isNull(reimbursementClaims.paymentId)));
  const [failed] = await db
    .select({ n: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${payments.amount}),0)::float` })
    .from(payments)
    .innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId))
    .where(and(eq(payments.tenantId, tid(c)), inArray(payments.status, ["failed", "held"]), ne(paymentBatches.status, "cancelled")));
  const [acct] = await db.select().from(companyBankAccounts).where(and(eq(companyBankAccounts.tenantId, tid(c)), eq(companyBankAccounts.active, true))).orderBy(desc(companyBankAccounts.isDefault)).limit(1);
  return c.json({
    readySalary: ready,
    claimsUnpaid: { amount: claims?.s ?? 0, claims: claims?.c ?? 0, employees: claims?.n ?? 0 },
    attention: { count: failed?.n ?? 0, amount: failed?.s ?? 0 },
    account: acct ? accountView(acct) : null,
  });
});

const batchRow = {
  batch: paymentBatches,
  bankName: companyBankAccounts.bankName,
  accountLast4: companyBankAccounts.accountLast4,
  count: sql<number>`(select count(*)::int from payments p where p.batch_id = "payment_batches"."id" and p.status <> 'cancelled')`,
  amount: sql<number>`(select coalesce(sum(p.amount),0)::float from payments p where p.batch_id = "payment_batches"."id" and p.status <> 'cancelled')`,
  paid: sql<number>`(select count(*)::int from payments p where p.batch_id = "payment_batches"."id" and p.status = 'paid')`,
  paidAmount: sql<number>`(select coalesce(sum(p.amount),0)::float from payments p where p.batch_id = "payment_batches"."id" and p.status = 'paid')`,
  failed: sql<number>`(select count(*)::int from payments p where p.batch_id = "payment_batches"."id" and p.status = 'failed')`,
  held: sql<number>`(select count(*)::int from payments p where p.batch_id = "payment_batches"."id" and p.status = 'held')`,
  pending: sql<number>`(select count(*)::int from payments p where p.batch_id = "payment_batches"."id" and p.status = 'pending')`,
};
type BatchRow = { batch: Batch; bankName: string | null; accountLast4: string | null; count: number; amount: number; paid: number; paidAmount: number; failed: number; held: number; pending: number };
const shapeBatch = (r: BatchRow) => ({ ...r.batch, bank: r.bankName ? `${r.bankName} ····${r.accountLast4}` : null, formatLabel: BANK_FORMAT_LABEL[r.batch.fileFormat as BankFileFormat], count: r.count, amount: r.amount, paid: r.paid, paidAmount: r.paidAmount, failed: r.failed, held: r.held, pending: r.pending });

paymentRoutes.get("/batches", requirePerm("payments", "view"), v("query", z.object({ type: z.string().optional() })), async (c) => {
  const q = c.req.valid("query");
  const conds: SQL[] = [eq(paymentBatches.tenantId, tid(c))];
  if (q.type) conds.push(inArray(paymentBatches.type, q.type.split(",")));
  const rows = (await c.get("db").select(batchRow).from(paymentBatches).leftJoin(companyBankAccounts, eq(companyBankAccounts.id, paymentBatches.bankAccountId)).where(and(...conds)).orderBy(desc(paymentBatches.createdAt)).limit(500)) as BatchRow[];
  return c.json(rows.map(shapeBatch));
});

async function loadBatch(c: Context<AppEnv>, id: string) {
  const [b] = await c.get("db").select().from(paymentBatches).where(and(eq(paymentBatches.id, id), eq(paymentBatches.tenantId, tid(c))));
  if (!b) throw notFound("Payment batch");
  return b;
}

const paymentRow = { p: payments, code: employees.employeeCode, name: employees.fullName, batchCode: paymentBatches.code, batchType: paymentBatches.type, batchLabel: paymentBatches.label };
type PaymentRow = { p: Payment; code: string; name: string; batchCode: string; batchType: string; batchLabel: string };
const shapePayment = (r: PaymentRow) => ({ ...r.p, employeeCode: r.code, employeeName: r.name, batchCode: r.batchCode, batchType: r.batchType, batchLabel: r.batchLabel });

paymentRoutes.get("/batches/:id", requirePerm("payments", "view"), async (c) => {
  const [r] = (await c.get("db").select(batchRow).from(paymentBatches).leftJoin(companyBankAccounts, eq(companyBankAccounts.id, paymentBatches.bankAccountId)).where(and(eq(paymentBatches.id, c.req.param("id")), eq(paymentBatches.tenantId, tid(c))))) as BatchRow[];
  if (!r) throw notFound("Payment batch");
  const rows = (await c.get("db").select(paymentRow).from(payments).innerJoin(employees, eq(employees.id, payments.employeeId)).innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId)).where(eq(payments.batchId, r.batch.id)).orderBy(asc(payments.reference))) as PaymentRow[];
  return c.json({ ...shapeBatch(r), payments: rows.map(shapePayment), canApprove: canApproveBatch(c, r.batch) === null, approveBlocked: canApproveBatch(c, r.batch) });
});

function canApproveBatch(c: Context<AppEnv>, b: Batch) {
  const p = c.get("tenant").permissions;
  if (!can(p, "payments", "approve")) return "You don't have approval rights for payments";
  if (b.status !== "draft") return null;
  if (b.createdBy === uid(c) && !(can(p, "users", "configure") && can(p, "payments", "configure"))) return "Someone other than the person who prepared this batch must approve it";
  return null;
}

/** Work out the lines for a new batch and everything worth warning about. */
async function prepare(c: Context<AppEnv>, b: z.infer<typeof batchCreateSchema>) {
  const db = c.get("db");
  const warnings: string[] = [];
  let lines: DraftLine[] = [];
  let label = b.label ?? "";
  let run: typeof payrollRuns.$inferSelect | undefined;
  let skipped: { employeeId: string; reason: string }[] = [];
  if (b.type === "salary") {
    if (!b.payrollRunId) throw badRequest("Pick the payroll month");
    [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, b.payrollRunId), eq(payrollRuns.tenantId, tid(c))));
    if (!run) throw notFound("Payroll run");
    if (run.status !== "approved") throw badRequest(run.status === "paid" ? "This payroll is already paid" : "Approve and lock the payroll first");
    const existing = await activeBatchForRun(db, run.id);
    if (existing) throw conflict(`${existing.code} already pays ${monthLabel(run.month)} salary. Cancel it first to build a new one.`);
    lines = await salaryLines(db, tid(c), run.id);
    label ||= `${monthLabel(run.month)} salary`;
    const [h] = await db.select({ n: sql<number>`count(*)::int` }).from(payrollItems).where(and(eq(payrollItems.runId, run.id), eq(payrollItems.onHold, true)));
    if (h?.n) warnings.push(`${h.n} salar${h.n === 1 ? "y is" : "ies are"} on hold in payroll and left out`);
  } else if (b.type === "reimbursement") {
    lines = await reimbursementLines(db, tid(c), b.claimIds);
    label ||= `Reimbursements · ${monthLabel(b.paymentDate.slice(0, 7))}`;
  } else if (b.type === "bonus" && b.bonus) {
    const [dup] = await db.select({ code: paymentBatches.code }).from(paymentBatches).where(and(eq(paymentBatches.tenantId, tid(c)), eq(paymentBatches.type, "bonus"), ne(paymentBatches.status, "cancelled"), sql`${paymentBatches.label} like ${"%FY " + b.bonus.fy + "%"}`));
    if (dup) throw conflict(`${dup.code} already pays bonus for FY ${b.bonus.fy}`);
    const r = await bonusLines(db, tid(c), b.bonus.fy, b.bonus.percent);
    lines = r.lines;
    skipped = r.skipped;
    label ||= `Statutory bonus FY ${b.bonus.fy}`;
    warnings.push("Bonus is taxable salary. This batch doesn't deduct TDS: include it in the TDS computation or pay it through payroll as a one-time earning.");
  } else {
    lines = (b.lines ?? []).map((l) => ({ employeeId: l.employeeId, amount: l.amount, description: l.description ?? null }));
    label ||= b.type === "bonus" ? "Bonus" : "Other payment";
    if (!lines.length) throw badRequest("Add at least one payment");
    const ids = new Set<string>();
    for (const l of lines) {
      if (ids.has(l.employeeId)) throw badRequest("Each employee can appear only once in a batch");
      ids.add(l.employeeId);
    }
    // same employee and amount in another live batch of this type in the last 30 days
    const since = new Date(Date.now() - 30 * 86400000);
    const recent = await db
      .select({ e: payments.employeeId, a: payments.amount, code: paymentBatches.code })
      .from(payments)
      .innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId))
      .where(and(eq(payments.tenantId, tid(c)), eq(paymentBatches.type, b.type), ne(payments.status, "cancelled"), gte(payments.createdAt, since), inArray(payments.employeeId, [...ids])));
    for (const l of lines) {
      const hit = recent.find((r) => r.e === l.employeeId && Number(r.a) === Number(l.amount));
      if (hit) warnings.push(`Possible duplicate: the same amount went to this employee in ${hit.code}`);
    }
  }
  const info = await bankInfo(db, tid(c), lines.map((l) => l.employeeId));
  if (info.size !== new Set(lines.map((l) => l.employeeId)).size) throw badRequest("Some employees weren't found");
  for (const l of lines) l.heldReason = missingBank(info.get(l.employeeId));
  const dups = await duplicateAccounts(db, tid(c), lines, c.env.ENCRYPTION_KEY);
  for (const d of dups) warnings.push(`Same account and amount for ${d}`);
  const payable = lines.filter((l) => !l.heldReason);
  return {
    label,
    run,
    lines,
    warnings,
    duplicates: dups.length,
    skipped,
    summary: {
      count: payable.length,
      amount: Math.round(payable.reduce((s, l) => s + l.amount, 0) * 100) / 100,
      missingBank: lines.filter((l) => l.heldReason).length,
      missingBankAmount: Math.round(lines.filter((l) => l.heldReason).reduce((s, l) => s + l.amount, 0) * 100) / 100,
    },
    info,
  };
}

paymentRoutes.post("/batches/preview", requirePerm("payments", "edit"), v("json", batchCreateSchema), async (c) => {
  const p = await prepare(c, c.req.valid("json"));
  return c.json({
    label: p.label,
    summary: p.summary,
    warnings: p.warnings,
    duplicates: p.duplicates,
    skipped: p.skipped.length,
    lines: p.lines.slice(0, 500).map((l) => ({ ...l, employeeCode: p.info.get(l.employeeId)?.code, employeeName: p.info.get(l.employeeId)?.name })),
  });
});

paymentRoutes.post("/batches", requirePerm("payments", "edit"), v("json", batchCreateSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const account = await loadAccount(db, tid(c), b.bankAccountId);
  if (!account || !account.active) throw badRequest("Pick an active debit account");
  const p = await prepare(c, b);
  if (!p.lines.length) throw badRequest(b.type === "reimbursement" ? "No approved claims are waiting for payment" : "Nothing to pay");
  if (p.duplicates) throw badRequest(p.warnings.find((w) => w.startsWith("Same account")) + ". Fix bank details before creating the batch.");
  const code = await nextBatchCode(db, tid(c), b.type, b.paymentDate);
  const [batch] = await db
    .insert(paymentBatches)
    .values({ tenantId: tid(c), code, type: b.type, label: p.label, payrollRunId: p.run?.id ?? null, bankAccountId: account.id, fileFormat: b.fileFormat ?? account.fileFormat, paymentDate: b.paymentDate, notes: b.notes ?? null, createdBy: uid(c) })
    .returning();
  const ref = await referenceAllocator(db, tid(c), b.type, b.paymentDate);
  const values = p.lines.map((l) => {
    const e = p.info.get(l.employeeId)!;
    return {
      tenantId: tid(c),
      batchId: batch!.id,
      employeeId: l.employeeId,
      reference: ref(),
      amount: l.amount,
      description: l.description ?? null,
      beneficiaryName: e.holder ?? e.name,
      bankName: e.bankName,
      ifsc: e.ifsc,
      accountLast4: e.last4,
      status: l.heldReason ? "held" : "pending",
      failureReason: l.heldReason ?? null,
    };
  });
  const created: Payment[] = [];
  for (let i = 0; i < values.length; i += 500) created.push(...(await db.insert(payments).values(values.slice(i, i + 500)).returning()));
  if (b.type === "reimbursement") {
    for (const l of p.lines) {
      const pay = created.find((x) => x.employeeId === l.employeeId)!;
      // only link claims still free (another batch may have taken them in the meantime)
      await db.update(reimbursementClaims).set({ paymentId: pay.id }).where(and(inArray(reimbursementClaims.id, l.claimIds ?? []), isNull(reimbursementClaims.paymentId), isNull(reimbursementClaims.payrollRunId)));
    }
  }
  await audit(c, { action: "payments.batch_create", entity: "payment_batch", entityId: batch!.id, summary: `Created ${code} (${p.label}): ${p.summary.count} payments, ${inr(p.summary.amount)}${p.summary.missingBank ? `, ${p.summary.missingBank} held for bank details` : ""}` });
  return c.json({ ...batch, summary: p.summary, warnings: p.warnings }, 201);
});

/** Draft bonus/other batches: add or remove lines. */
paymentRoutes.post("/batches/:id/lines", requirePerm("payments", "edit"), v("json", z.object({ employeeId: z.string(), amount: z.coerce.number().positive().max(1e8), description: z.string().max(120).nullable().optional() })), async (c) => {
  const batch = await loadBatch(c, c.req.param("id"));
  if (batch.status !== "draft" || (batch.type !== "bonus" && batch.type !== "other")) throw badRequest("Lines can only be changed on a draft bonus or other batch");
  const b = c.req.valid("json");
  const info = await bankInfo(c.get("db"), tid(c), [b.employeeId]);
  const e = info.get(b.employeeId);
  if (!e) throw notFound("Employee");
  const held = missingBank(e);
  const ref = await referenceAllocator(c.get("db"), tid(c), batch.type as "bonus", batch.paymentDate);
  const [row] = await c
    .get("db")
    .insert(payments)
    .values({ tenantId: tid(c), batchId: batch.id, employeeId: e.id, reference: ref(), amount: b.amount, description: b.description ?? null, beneficiaryName: e.holder ?? e.name, bankName: e.bankName, ifsc: e.ifsc, accountLast4: e.last4, status: held ? "held" : "pending", failureReason: held })
    .returning();
  return c.json(row, 201);
});

paymentRoutes.delete("/batches/:id/lines/:paymentId", requirePerm("payments", "edit"), async (c) => {
  const batch = await loadBatch(c, c.req.param("id"));
  if (batch.status !== "draft" || (batch.type !== "bonus" && batch.type !== "other")) throw badRequest("Lines can only be changed on a draft bonus or other batch");
  await c.get("db").delete(payments).where(and(eq(payments.id, c.req.param("paymentId")), eq(payments.batchId, batch.id)));
  return c.json({ ok: true });
});

paymentRoutes.post("/batches/:id/approve", requirePerm("payments", "approve"), async (c) => {
  const batch = await loadBatch(c, c.req.param("id"));
  if (batch.status !== "draft") throw badRequest("Only a draft batch can be approved");
  const why = canApproveBatch(c, batch);
  if (why) throw forbidden(why);
  const [open] = await c.get("db").select({ n: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.batchId, batch.id), eq(payments.status, "pending")));
  if (!open?.n) throw badRequest("There's nothing to pay in this batch");
  const [row] = await c.get("db").update(paymentBatches).set({ status: "approved", approvedBy: uid(c), approvedAt: new Date() }).where(and(eq(paymentBatches.id, batch.id), eq(paymentBatches.status, "draft"))).returning();
  if (!row) throw badRequest("This batch changed. Reload and try again.");
  await audit(c, { action: "payments.batch_approve", entity: "payment_batch", entityId: batch.id, summary: `Approved ${batch.code}` });
  return c.json(row);
});

paymentRoutes.post("/batches/:id/cancel", requirePerm("payments", "edit"), v("json", z.object({ reason: z.string().trim().min(3, "Add a reason").max(300) })), async (c) => {
  const batch = await loadBatch(c, c.req.param("id"));
  if (batch.status !== "draft" && batch.status !== "approved") throw badRequest("The bank file was already exported. Record each payment as failed or held instead.");
  const db = c.get("db");
  const rows = await db.update(payments).set({ status: "cancelled", updatedBy: uid(c) }).where(and(eq(payments.batchId, batch.id), ne(payments.status, "paid"))).returning();
  await applyPaymentEffects(db, batch, rows);
  const [row] = await db.update(paymentBatches).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(paymentBatches.id, batch.id)).returning();
  await audit(c, { action: "payments.batch_cancel", entity: "payment_batch", entityId: batch.id, summary: `Cancelled ${batch.code}`, data: c.req.valid("json") });
  return c.json(row);
});

/**
 * Bank upload file. Contains the payments still pending (all of them the first time,
 * retries afterwards). Uses the employee's current bank details.
 */
paymentRoutes.get("/batches/:id/file", requirePerm("payments", "export"), async (c) => {
  const batch = await loadBatch(c, c.req.param("id"));
  if (batch.status === "draft") throw badRequest("Approve the batch before exporting the bank file");
  if (batch.status === "cancelled") throw badRequest("This batch is cancelled");
  const db = c.get("db");
  const account = await loadAccount(db, tid(c), batch.bankAccountId);
  if (!account) throw badRequest("Set the debit account on this batch first");
  const rows = await db
    .select({ p: payments, code: employees.employeeCode, name: employees.fullName, holder: employees.accountHolderName, enc: employees.accountNumberEnc, ifsc: employees.ifsc, bankName: employees.bankName, last4: employees.accountLast4, email: employees.workEmail, method: employees.paymentMethod })
    .from(payments)
    .innerJoin(employees, eq(employees.id, payments.employeeId))
    .where(and(eq(payments.batchId, batch.id), eq(payments.status, "pending")))
    .orderBy(asc(payments.reference));
  if (!rows.length) throw badRequest("No payments are pending in this batch");
  const lines = [];
  const seen = new Map<string, string>();
  const narration = batch.type === "salary" ? `Salary ${batch.label.replace(/ salary$/, "")}` : batch.type === "reimbursement" ? "Reimbursement" : batch.type === "bonus" ? "Bonus" : batch.label;
  for (const r of rows) {
    const acct = await decryptField(r.enc, c.env.ENCRYPTION_KEY);
    if (!acct || !r.ifsc || r.method !== "bank_transfer") {
      await db.update(payments).set({ status: "held", failureReason: "Bank details missing" }).where(eq(payments.id, r.p.id));
      continue;
    }
    const k = `${acct}|${r.p.amount}`;
    if (seen.has(k)) throw badRequest(`Duplicate payment: ${seen.get(k)} and ${r.code} go to the same account (ending ${acct.slice(-4)}) for the same amount. Fix bank details first.`);
    seen.set(k, r.code);
    lines.push({ reference: r.p.reference, employeeCode: r.code, beneficiaryName: r.holder ?? r.name, accountNumber: acct, ifsc: r.ifsc, amount: Number(r.p.amount), narration, email: r.email });
  }
  if (!lines.length) throw badRequest("Every pending payment is missing bank details");
  const debit = await decryptField(account.accountNumberEnc, c.env.ENCRYPTION_KEY);
  const file = buildBankFile(batch.fileFormat as BankFileFormat, { accountNumber: debit ?? "", ifsc: account.ifsc, clientCode: account.clientCode }, batch.paymentDate, lines);
  const now = new Date();
  await db
    .update(payments)
    .set({ attempts: sql`${payments.attempts} + 1`, lastExportedAt: now })
    .where(inArray(payments.reference, lines.map((l) => l.reference)));
  await db.update(paymentBatches).set({ status: "processing", exportedAt: batch.exportedAt ?? now, exportCount: sql`${paymentBatches.exportCount} + 1` }).where(eq(paymentBatches.id, batch.id));
  if (batch.payrollRunId) await db.update(payrollRuns).set({ bankFileExportedAt: now }).where(and(eq(payrollRuns.id, batch.payrollRunId), isNull(payrollRuns.bankFileExportedAt)));
  await audit(c, { action: "payments.file_export", entity: "payment_batch", entityId: batch.id, summary: `Exported ${BANK_FORMAT_LABEL[batch.fileFormat as BankFileFormat]} file for ${batch.code}: ${lines.length} payments, ${inr(lines.reduce((s, l) => s + l.amount, 0))}${batch.exportCount ? " (re-export)" : ""}` });
  return c.body(file.body, 200, { "Content-Type": file.mime, "Content-Disposition": `attachment; filename="${batch.code}${batch.exportCount ? `-retry${batch.exportCount}` : ""}.${file.ext}"`, "Cache-Control": "no-store" });
});

// ---------------------------------------------------------------------------
// Payment status: one, many, or from the bank's response file
// ---------------------------------------------------------------------------
async function notifyFailed(c: Context<AppEnv>, list: Payment[]) {
  if (!list.length) return;
  try {
    const rows = await c.get("db").select({ id: employees.id, email: employees.workEmail, first: employees.firstName, company: tenants.name }).from(employees).innerJoin(tenants, eq(tenants.id, employees.tenantId)).where(inArray(employees.id, list.map((p) => p.employeeId)));
    for (const p of list) {
      const e = rows.find((r) => r.id === p.employeeId);
      if (!e?.email) continue;
      const { html, text } = layout({
        company: e.company,
        heading: "We couldn't credit your payment",
        paragraphs: [`Hi ${e.first},`, `A payment of ${inr(Number(p.amount))} (reference ${p.reference}) was returned by the bank${p.failureReason ? `: ${p.failureReason}` : ""}.`, "Please check your bank details in self-service or with HR. We'll retry once they're correct."],
        cta: { label: "Check my bank details", url: `${c.env.APP_URL}/me/profile` },
      });
      await c.get("mailer").send({ to: e.email, subject: `Payment ${p.reference} returned by the bank`, html, text });
    }
  } catch (err) {
    console.error("payment failure email failed", err);
  }
}

async function updatePayments(c: Context<AppEnv>, ids: string[], u: z.infer<typeof paymentUpdateSchema>) {
  const db = c.get("db");
  const rows = await db.select({ p: payments, b: paymentBatches }).from(payments).innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId)).where(and(eq(payments.tenantId, tid(c)), inArray(payments.id, ids)));
  const errors: { id: string; message: string }[] = [];
  const changed = new Map<string, { batch: Batch; list: Payment[] }>();
  const failedNow: Payment[] = [];
  for (const id of ids) if (!rows.some((r) => r.p.id === id)) errors.push({ id, message: "Payment not found" });
  for (const { p, b } of rows) {
    const why = canTransition(b, p.status, u.status);
    if (why) {
      errors.push({ id: p.id, message: `${p.reference}: ${why}` });
      continue;
    }
    if (u.status === "failed" && !u.reason) {
      errors.push({ id: p.id, message: "Add the bank's reason for the failure" });
      continue;
    }
    const patch: Partial<Payment> = { status: u.status, updatedBy: uid(c) };
    if (u.status === "paid") Object.assign(patch, { utr: u.utr ?? p.utr, paidAt: u.paidOn ? new Date(u.paidOn + "T12:00:00+05:30") : new Date(), note: p.status !== "pending" ? (u.reason ?? "Paid outside the bank file") : (u.reason ?? null), failureReason: null });
    if (u.status === "failed") Object.assign(patch, { failureReason: u.reason });
    if (u.status === "held") Object.assign(patch, { failureReason: u.reason ?? p.failureReason ?? "On hold" });
    if (u.status === "cancelled") Object.assign(patch, { note: u.reason ?? null });
    if (u.status === "pending") {
      // retry: needs bank details, and picks up the latest ones
      const e = (await bankInfo(db, tid(c), [p.employeeId])).get(p.employeeId);
      const missing = missingBank(e);
      if (missing) {
        errors.push({ id: p.id, message: `${p.reference}: ${missing}. Update them first.` });
        continue;
      }
      Object.assign(patch, { failureReason: null, beneficiaryName: e!.holder ?? e!.name, bankName: e!.bankName, ifsc: e!.ifsc, accountLast4: e!.last4 });
      // a retry needs a fresh export, so a completed batch goes back to processing
      if (b.status === "completed") await db.update(paymentBatches).set({ status: "processing", completedAt: null }).where(eq(paymentBatches.id, b.id));
    }
    const [row] = await db.update(payments).set(patch).where(and(eq(payments.id, p.id), eq(payments.status, p.status))).returning();
    if (!row) {
      errors.push({ id: p.id, message: `${p.reference} changed. Reload and try again.` });
      continue;
    }
    const g = changed.get(b.id) ?? { batch: b, list: [] };
    g.list.push(row);
    changed.set(b.id, g);
    if (u.status === "failed") failedNow.push(row);
  }
  for (const { batch, list } of changed.values()) {
    await applyPaymentEffects(db, batch, list);
    const { batch: fresh, completed } = await refreshBatch(db, batch.id);
    if (completed && fresh) await completeSalaryRun(db, fresh, uid(c));
    await audit(c, { action: `payments.mark_${u.status}`, entity: "payment_batch", entityId: batch.id, summary: `${batch.code}: marked ${list.length} payment${list.length === 1 ? "" : "s"} ${u.status}${u.reason ? ` (${u.reason})` : ""}` });
  }
  await notifyFailed(c, failedNow);
  return { done: ids.length - errors.length, errors };
}

paymentRoutes.patch("/payments/:id", requirePerm("payments", "edit"), v("json", paymentUpdateSchema), async (c) => {
  const r = await updatePayments(c, [c.req.param("id")], c.req.valid("json"));
  if (r.errors.length) throw badRequest(r.errors[0]!.message);
  return c.json(r);
});

paymentRoutes.post("/payments/bulk", requirePerm("payments", "edit"), v("json", bulkPaymentUpdateSchema), async (c) => {
  const { ids, ...u } = c.req.valid("json");
  return c.json(await updatePayments(c, ids, u));
});

/** Mark every pending payment in a batch as paid (bank confirmed the whole file). */
paymentRoutes.post("/batches/:id/mark-all-paid", requirePerm("payments", "edit"), v("json", z.object({ paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })), async (c) => {
  const batch = await loadBatch(c, c.req.param("id"));
  if (batch.status !== "processing") throw badRequest("Export the bank file first");
  const ids = (await c.get("db").select({ id: payments.id }).from(payments).where(and(eq(payments.batchId, batch.id), eq(payments.status, "pending")))).map((r) => r.id);
  if (!ids.length) throw badRequest("No payments are pending");
  return c.json(await updatePayments(c, ids, { status: "paid", paidOn: c.req.valid("json").paidOn ?? todayIST(), utr: null, reason: null }));
});

/** Reconcile from the bank's status file: matches on reference, marks paid or failed. */
paymentRoutes.post("/batches/:id/reconcile", requirePerm("payments", "edit"), async (c) => {
  const batch = await loadBatch(c, c.req.param("id"));
  if (batch.status !== "processing" && batch.status !== "completed") throw badRequest("Export the bank file first");
  const form = await c.req.formData();
  const f = form.get("file");
  const text = f instanceof File ? await f.text() : String(form.get("text") ?? "");
  if (!text.trim()) throw badRequest("Upload the bank's status file");
  if (text.length > 5_000_000) throw badRequest("The file is too large");
  const parsed = parseBankResponse(text);
  if (!parsed.rows.length) throw badRequest(parsed.errors[0] ?? "No rows found");
  const db = c.get("db");
  const list = await db.select().from(payments).where(eq(payments.batchId, batch.id));
  const byRef = new Map(list.map((p) => [p.reference, p]));
  const unknown: string[] = [];
  const already: string[] = [];
  const paid: { id: string; utr: string | null }[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const r of parsed.rows) {
    const p = byRef.get(r.reference);
    if (!p) unknown.push(r.reference);
    else if (p.status !== "pending") already.push(r.reference);
    else if (r.status === "paid") paid.push({ id: p.id, utr: r.utr });
    else failed.push({ id: p.id, reason: r.reason ?? "Returned by bank" });
  }
  const errors: string[] = [...parsed.errors];
  // UTRs differ per row, so paid rows go one by one; failures group by reason
  for (const p of paid) errors.push(...(await updatePayments(c, [p.id], { status: "paid", utr: p.utr, paidOn: todayIST(), reason: null })).errors.map((e) => e.message));
  for (const p of failed) errors.push(...(await updatePayments(c, [p.id], { status: "failed", reason: p.reason, utr: null, paidOn: null })).errors.map((e) => e.message));
  return c.json({ rows: parsed.rows.length, paid: paid.length, failed: failed.length, unknown, alreadyUpdated: already.length, errors });
});

/** Failed and held payments across batches (the "attention" list). */
paymentRoutes.get("/attention", requirePerm("payments", "view"), async (c) => {
  const rows = (await c
    .get("db")
    .select(paymentRow)
    .from(payments)
    .innerJoin(employees, eq(employees.id, payments.employeeId))
    .innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId))
    .where(and(eq(payments.tenantId, tid(c)), inArray(payments.status, ["failed", "held"]), ne(paymentBatches.status, "cancelled")))
    .orderBy(desc(payments.updatedAt))) as PaymentRow[];
  return c.json(rows.map(shapePayment));
});

// ---------------------------------------------------------------------------
// Paid / unpaid report
// ---------------------------------------------------------------------------
const reportQuery = z.object({ type: z.string().optional(), status: z.string().optional(), from: z.string().optional(), to: z.string().optional(), batchId: z.string().optional(), format: z.enum(["csv", "xlsx"]).default("csv") });

paymentRoutes.get("/report", requirePerm("payments", "export"), v("query", reportQuery), async (c) => {
  const q = c.req.valid("query");
  const conds: SQL[] = [eq(payments.tenantId, tid(c)), ne(paymentBatches.status, "cancelled")];
  if (q.type) conds.push(inArray(paymentBatches.type, q.type.split(",")));
  if (q.status) conds.push(inArray(payments.status, q.status.split(",")));
  else conds.push(notInArray(payments.status, ["cancelled"]));
  if (q.from) conds.push(gte(paymentBatches.paymentDate, q.from));
  if (q.to) conds.push(lte(paymentBatches.paymentDate, q.to));
  if (q.batchId) conds.push(eq(payments.batchId, q.batchId));
  const rows = await c
    .get("db")
    .select({ ...paymentRow, date: paymentBatches.paymentDate })
    .from(payments)
    .innerJoin(employees, eq(employees.id, payments.employeeId))
    .innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId))
    .where(and(...conds))
    .orderBy(asc(paymentBatches.paymentDate), asc(payments.reference));
  const header = ["Batch", "Type", "Description", "Payment date", "Reference", "Employee ID", "Employee", "Beneficiary", "Bank", "IFSC", "Account", "Amount", "Status", "UTR", "Paid on", "Reason / note", "Attempts"];
  const data = rows.map((r) => [r.batchCode, r.batchType, r.p.description ?? r.batchLabel, r.date, r.p.reference, r.code, r.name, r.p.beneficiaryName, r.p.bankName, r.p.ifsc, r.p.accountLast4 ? `····${r.p.accountLast4}` : "", Number(r.p.amount), r.p.status, r.p.utr, r.p.paidAt ? r.p.paidAt.toISOString().slice(0, 10) : "", r.p.failureReason ?? r.p.note, r.p.attempts]);
  await audit(c, { action: "payments.report", entity: "payment", summary: `Exported payments report (${rows.length} rows, ${q.format})` });
  const name = `payments-${todayIST()}`;
  if (q.format === "xlsx") return c.body(toXlsx([{ name: "Payments", header, rows: data }]) as unknown as ArrayBuffer, 200, { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${name}.xlsx"` });
  return c.body(toCsv(header, data), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` });
});
