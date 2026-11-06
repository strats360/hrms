import { Hono, type Context } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { employees, payrollItems, payrollRuns, statutoryChallans, taxDeclarations, taxProofs, tdsReturns, tenants, type Database } from "@hrms/db";
import {
  compareRegimes,
  computeTaxStatement,
  declaredBySection,
  fmtDate,
  isoDate,
  nullable,
  TAX_SECTIONS,
  TAX_SECTION_LABELS,
  taxDeclarationDataSchema,
  tdsReturnDueDates,
  todayIST,
  type Regime,
  type TaxDeclarationData,
  type TaxSection,
  type Verified,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { layout } from "../lib/email";
import { ALLOWED_TYPES, deleteFile, getFile, MAX_UPLOAD_BYTES, putFile, safeName } from "../lib/storage";
import { getTemplate, resolveStructure, structuresAsOf } from "../services/payroll";
import { currentFy, employeeTax, form16, fyMonths, QUARTERS, quarterOf } from "../services/tax";

export const tdsRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const fyQuery = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const sectionSchema = z.enum(TAX_SECTIONS);

// ---------------------------------------------------------------------------
// Summary: one row per employee
// ---------------------------------------------------------------------------
tdsRoutes.get("/summary", requirePerm("tds", "view"), v("query", fyQuery), async (c) => {
  const db = c.get("db");
  const fy = c.req.valid("query").fy ?? currentFy();
  const months = fyMonths(fy);
  const items = await db
    .select({ employeeId: payrollItems.employeeId, month: payrollRuns.month, gross: payrollItems.taxableGross, tds: payrollItems.tds, pf: payrollItems.employeePf, pt: payrollItems.professionalTax, earnings: payrollItems.earnings, snapshot: payrollItems.snapshot })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tid(c)), inArray(payrollRuns.status, ["approved", "paid"]), inArray(payrollRuns.month, months)));
  const lastMonth = items.reduce((m, i) => (i.month > m ? i.month : m), "");
  const ids = [...new Set(items.map((i) => i.employeeId))];
  // include current employees with no payroll yet this FY
  const current = await db.select().from(employees).where(and(eq(employees.tenantId, tid(c)), sql`${employees.status} in ('active','probation','notice')`));
  for (const e of current) if (!ids.includes(e.id)) ids.push(e.id);
  const emps = ids.length ? await db.select().from(employees).where(inArray(employees.id, ids)) : [];
  const decls = ids.length ? await db.select().from(taxDeclarations).where(and(eq(taxDeclarations.tenantId, tid(c)), eq(taxDeclarations.fy, fy), inArray(taxDeclarations.employeeId, ids))) : [];
  const template = await getTemplate(db, tid(c));
  const structs = await structuresAsOf(db, tid(c), ids, `${months[11]}-28`);
  const monthsLeft = months.filter((m) => m > lastMonth).length;
  const line = (lines: { code: string; amount: number }[], code: string) => lines.filter((l) => l.code === code).reduce((s, l) => s + l.amount, 0);

  const rows = emps.map((e) => {
    const mine = items.filter((i) => i.employeeId === e.id);
    const d = decls.find((x) => x.employeeId === e.id);
    const active = !e.lastWorkingDay || e.lastWorkingDay > `${lastMonth || months[0]}-28`;
    const s = resolveStructure(e, structs.get(e.id), template);
    const proj = active && e.status !== "exited" && e.status !== "inactive" ? monthsLeft : 0;
    const sum = (f: (i: (typeof mine)[number]) => number) => mine.reduce((a, i) => a + f(i), 0);
    const regime = (d?.regime ?? e.taxRegime) as Regime;
    const st = computeTaxStatement({
      regime,
      financialYear: fy,
      salary: { gross: sum((i) => Number(i.gross)) + s.gross * proj, basic: sum((i) => line(i.earnings, "basic")) + s.components.basic * proj, hra: sum((i) => line(i.earnings, "hra")) + s.components.hra * proj },
      employeePf: sum((i) => Number(i.pf)) + (e.pfApplicable ? Math.min(1800, Math.round(s.components.basic * 0.12)) : 0) * proj,
      professionalTax: sum((i) => Number(i.pt)) + (e.ptApplicable ? 200 : 0) * proj,
      declaration: d?.data,
      verified: d?.verified,
    });
    const ytd = sum((i) => Number(i.tds));
    const declared = declaredBySection(d?.data);
    return {
      employeeId: e.id,
      name: e.fullName,
      code: e.employeeCode,
      pan: e.pan,
      regime,
      declarationStatus: d?.status ?? "not_started",
      declared80C: declared["80C"],
      declaredTotal: Object.entries(declared).filter(([k]) => k !== "previousEmployer").reduce((a, [, x]) => a + x, 0),
      taxableIncome: st.taxableIncome,
      annualTax: st.tax.total,
      monthlyTds: Number(mine.find((i) => i.month === lastMonth)?.tds ?? 0),
      deducted: ytd,
      remaining: Math.max(0, st.tax.total - st.previousEmployerTds - ytd),
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return c.json({
    fy,
    lastMonth: lastMonth || null,
    totals: {
      monthlyTds: rows.reduce((s, r) => s + r.monthlyTds, 0),
      deducted: rows.reduce((s, r) => s + r.deducted, 0),
      newRegime: rows.filter((r) => r.regime === "new").length,
      oldRegime: rows.filter((r) => r.regime === "old").length,
      submitted: rows.filter((r) => r.declarationStatus === "submitted" || r.declarationStatus === "verified").length,
      pending: rows.filter((r) => r.declarationStatus === "not_started" || r.declarationStatus === "draft").length,
      nilTax: rows.filter((r) => r.annualTax === 0).length,
    },
    rows,
  });
});

tdsRoutes.get("/employees/:id", requirePerm("tds", "view"), v("query", fyQuery), async (c) => {
  const r = await employeeTax(c.get("db"), tid(c), c.req.param("id"), c.req.valid("query").fy ?? currentFy());
  if (!r) throw notFound("Employee");
  return c.json(r);
});

/** HR switches an employee's regime (e.g. on their written request). */
tdsRoutes.patch("/employees/:id/regime", requirePerm("tds", "edit"), v("json", z.object({ regime: z.enum(["new", "old"]), fy: z.string().optional() })), async (c) => {
  const b = c.req.valid("json");
  const fy = b.fy ?? currentFy();
  const db = c.get("db");
  const [e] = await db.select().from(employees).where(and(eq(employees.id, c.req.param("id")), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  await upsertDeclaration(db, tid(c), e.id, fy, { regime: b.regime });
  if (fy === currentFy()) await db.update(employees).set({ taxRegime: b.regime }).where(eq(employees.id, e.id));
  await audit(c, { action: "tds.regime", entity: "employee", entityId: e.id, summary: `Set ${e.fullName}'s tax regime to ${b.regime} for FY ${fy}` });
  return c.json({ ok: true });
});

async function upsertDeclaration(db: Database, tenantId: string, employeeId: string, fy: string, patch: Partial<typeof taxDeclarations.$inferInsert>) {
  const [row] = await db
    .insert(taxDeclarations)
    .values({ tenantId, employeeId, fy, ...patch })
    .onConflictDoUpdate({ target: [taxDeclarations.tenantId, taxDeclarations.employeeId, taxDeclarations.fy], set: patch })
    .returning();
  return row!;
}

// ---------------------------------------------------------------------------
// Declarations & proofs (HR)
// ---------------------------------------------------------------------------
tdsRoutes.get("/declarations", requirePerm("tds", "view"), v("query", fyQuery.extend({ status: z.string().optional() })), async (c) => {
  const q = c.req.valid("query");
  const fy = q.fy ?? currentFy();
  const db = c.get("db");
  const conds = [eq(taxDeclarations.tenantId, tid(c)), eq(taxDeclarations.fy, fy)];
  if (q.status) conds.push(inArray(taxDeclarations.status, q.status.split(",")));
  const rows = await db
    .select({ d: taxDeclarations, name: employees.fullName, code: employees.employeeCode, pan: employees.pan })
    .from(taxDeclarations)
    .innerJoin(employees, eq(employees.id, taxDeclarations.employeeId))
    .where(and(...conds))
    .orderBy(asc(employees.fullName));
  const proofs = rows.length ? await db.select({ declarationId: taxProofs.declarationId, status: taxProofs.status }).from(taxProofs).where(inArray(taxProofs.declarationId, rows.map((r) => r.d.id))) : [];
  return c.json(
    rows.map((r) => ({
      id: r.d.id,
      employeeId: r.d.employeeId,
      name: r.name,
      code: r.code,
      pan: r.pan,
      regime: r.d.regime,
      status: r.d.status,
      submittedAt: r.d.submittedAt,
      declared: declaredBySection(r.d.data),
      verified: r.d.verified,
      proofs: { total: proofs.filter((p) => p.declarationId === r.d.id).length, pending: proofs.filter((p) => p.declarationId === r.d.id && p.status === "pending").length },
    })),
  );
});

tdsRoutes.get("/declarations/:id", requirePerm("tds", "view"), async (c) => {
  const db = c.get("db");
  const [d] = await db.select().from(taxDeclarations).where(and(eq(taxDeclarations.id, c.req.param("id")), eq(taxDeclarations.tenantId, tid(c))));
  if (!d) throw notFound("Declaration");
  const [e] = await db.select({ name: employees.fullName, code: employees.employeeCode }).from(employees).where(eq(employees.id, d.employeeId));
  const proofs = await db.select().from(taxProofs).where(eq(taxProofs.declarationId, d.id)).orderBy(asc(taxProofs.createdAt));
  return c.json({ ...d, employeeName: e?.name, employeeCode: e?.code, declared: declaredBySection(d.data), proofs });
});

tdsRoutes.post(
  "/declarations/:id/verify",
  requirePerm("tds", "edit"),
  v("json", z.object({ verified: z.partialRecord(sectionSchema, z.number().min(0).max(1e9)), lock: z.boolean().default(false) })),
  async (c) => {
    const db = c.get("db");
    const b = c.req.valid("json");
    const [d] = await db.select().from(taxDeclarations).where(and(eq(taxDeclarations.id, c.req.param("id")), eq(taxDeclarations.tenantId, tid(c))));
    if (!d) throw notFound("Declaration");
    if (d.status === "draft") throw badRequest("The employee hasn't submitted this declaration yet");
    if (d.employeeId === c.get("tenant").employeeId) throw forbidden("You can't verify your own tax declaration");
    const verified: Verified = { ...d.verified, ...b.verified };
    const [row] = await db
      .update(taxDeclarations)
      .set({ verified, ...(b.lock ? { status: "verified", verifiedAt: new Date(), verifiedBy: c.get("session")!.userId } : {}) })
      .where(eq(taxDeclarations.id, d.id))
      .returning();
    await audit(c, { action: "tds.verify", entity: "tax_declaration", entityId: d.id, summary: `Verified tax proofs${b.lock ? " and locked the declaration" : ""}`, data: b.verified });
    return c.json(row);
  },
);

tdsRoutes.post("/declarations/:id/reopen", requirePerm("tds", "configure"), async (c) => {
  const [row] = await c
    .get("db")
    .update(taxDeclarations)
    .set({ status: "submitted", verifiedAt: null, verifiedBy: null })
    .where(and(eq(taxDeclarations.id, c.req.param("id")), eq(taxDeclarations.tenantId, tid(c))))
    .returning();
  if (!row) throw notFound("Declaration");
  await audit(c, { action: "tds.reopen", entity: "tax_declaration", entityId: row.id, summary: "Reopened a locked tax declaration" });
  return c.json(row);
});

tdsRoutes.patch("/proofs/:id", requirePerm("tds", "edit"), v("json", z.object({ status: z.enum(["accepted", "rejected", "pending"]), note: nullable(z.string().trim().max(300)) })), async (c) => {
  const [owner] = await c
    .get("db")
    .select({ employeeId: taxDeclarations.employeeId })
    .from(taxProofs)
    .innerJoin(taxDeclarations, eq(taxDeclarations.id, taxProofs.declarationId))
    .where(and(eq(taxProofs.id, c.req.param("id")), eq(taxProofs.tenantId, tid(c))));
  if (!owner) throw notFound("Proof");
  if (owner.employeeId === c.get("tenant").employeeId) throw forbidden("You can't review your own proofs");
  const [row] = await c
    .get("db")
    .update(taxProofs)
    .set(c.req.valid("json"))
    .where(and(eq(taxProofs.id, c.req.param("id")), eq(taxProofs.tenantId, tid(c))))
    .returning();
  if (!row) throw notFound("Proof");
  await audit(c, { action: `tds.proof_${row.status}`, entity: "tax_proof", entityId: row.id, summary: `Marked proof ${row.fileName} as ${row.status}` });
  return c.json(row);
});

export async function sendProofFile(c: Context<AppEnv>, proof: typeof taxProofs.$inferSelect) {
  const file = await getFile(c.env, proof.fileKey);
  if (!file) throw notFound("File");
  return new Response(file.body as BodyInit, {
    headers: { "Content-Type": file.type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(proof.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

tdsRoutes.get("/proofs/:id/file", requirePerm("tds", "view"), async (c) => {
  const [p] = await c.get("db").select().from(taxProofs).where(and(eq(taxProofs.id, c.req.param("id")), eq(taxProofs.tenantId, tid(c))));
  if (!p) throw notFound("Proof");
  return sendProofFile(c, p);
});

/** Email employees who haven't submitted a declaration for the FY. */
tdsRoutes.post("/declarations/remind", requirePerm("tds", "edit"), v("json", fyQuery), async (c) => {
  const db = c.get("db");
  const fy = c.req.valid("json").fy ?? currentFy();
  const emps = await db.select().from(employees).where(and(eq(employees.tenantId, tid(c)), sql`${employees.status} in ('active','probation','notice')`));
  const done = new Set(
    (await db.select({ e: taxDeclarations.employeeId }).from(taxDeclarations).where(and(eq(taxDeclarations.tenantId, tid(c)), eq(taxDeclarations.fy, fy), inArray(taxDeclarations.status, ["submitted", "verified"])))).map((r) => r.e),
  );
  const pending = emps.filter((e) => !done.has(e.id));
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  let sent = 0;
  for (let i = 0; i < pending.length; i += 10) {
    await Promise.all(
      pending.slice(i, i + 10).map(async (e) => {
        const { html, text } = layout({
          company: t?.name ?? "Strats360 People",
          heading: `Submit your tax declaration for FY ${fy}`,
          paragraphs: [`Hi ${e.firstName},`, "Choose your tax regime and declare your investments (80C, health insurance, rent and so on) so we deduct the right TDS from your salary.", "If you don't submit, TDS is worked out under the new regime with no deductions."],
          cta: { label: "Open tax declaration", url: `${c.env.APP_URL}/me/tax` },
        });
        try {
          await c.get("mailer").send({ to: e.workEmail, subject: `Tax declaration for FY ${fy}`, html, text });
          sent++;
        } catch (err) {
          console.error("reminder failed", err);
        }
      }),
    );
  }
  await audit(c, { action: "tds.remind", entity: "tax_declaration", summary: `Sent tax declaration reminders to ${sent} employees (FY ${fy})` });
  return c.json({ sent });
});

// ---------------------------------------------------------------------------
// 24Q returns and Form 16
// ---------------------------------------------------------------------------
tdsRoutes.get("/returns", requirePerm("tds", "view"), v("query", fyQuery), async (c) => {
  const db = c.get("db");
  const fy = c.req.valid("query").fy ?? currentFy();
  const months = fyMonths(fy);
  const filed = await db.select().from(tdsReturns).where(and(eq(tdsReturns.tenantId, tid(c)), eq(tdsReturns.fy, fy)));
  const totals = await db
    .select({ month: payrollRuns.month, tds: sql<number>`sum(${payrollItems.tds})::float`, gross: sql<number>`sum(${payrollItems.taxableGross})::float`, n: sql<number>`count(*) filter (where ${payrollItems.tds} > 0)::int` })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, ["approved", "paid"]), inArray(payrollRuns.month, months)))
    .groupBy(payrollRuns.month);
  const challans = await db.select().from(statutoryChallans).where(and(eq(statutoryChallans.tenantId, tid(c)), eq(statutoryChallans.statute, "tds"), inArray(statutoryChallans.period, months)));
  const dues = tdsReturnDueDates(fy);
  return c.json({
    fy,
    quarters: Object.entries(QUARTERS).map(([q]) => {
      const qm = months.filter((m) => quarterOf(m) === q);
      const rows = totals.filter((t) => qm.includes(t.month));
      const f = filed.find((x) => x.quarter === q);
      return {
        quarter: q,
        months: qm,
        due: dues.find((d) => d.quarter === q)!.due,
        lockedMonths: rows.length,
        tdsDeducted: rows.reduce((s, r) => s + Number(r.tds), 0),
        amountPaid: rows.reduce((s, r) => s + Number(r.gross), 0),
        tdsDeposited: challans.filter((ch) => qm.includes(ch.period)).reduce((s, ch) => s + Number(ch.amountPaid), 0),
        challansMissing: rows.filter((r) => Number(r.tds) > 0 && !challans.some((ch) => ch.period === r.month)).map((r) => r.month),
        filed: f ? { filedOn: f.filedOn, acknowledgement: f.acknowledgement, notes: f.notes } : null,
      };
    }),
  });
});

tdsRoutes.put(
  "/returns/:fy/:quarter",
  requirePerm("tds", "edit"),
  v("json", z.object({ filedOn: isoDate, acknowledgement: nullable(z.string().trim().max(40)), notes: nullable(z.string().trim().max(300)) })),
  async (c) => {
    const { fy, quarter } = c.req.param();
    if (!QUARTERS[quarter]) throw badRequest("Unknown quarter");
    const b = c.req.valid("json");
    if (b.filedOn > todayIST()) throw badRequest("The filing date can't be in the future");
    const [row] = await c
      .get("db")
      .insert(tdsReturns)
      .values({ tenantId: tid(c), fy, quarter, ...b, createdBy: c.get("session")!.userId })
      .onConflictDoUpdate({ target: [tdsReturns.tenantId, tdsReturns.fy, tdsReturns.quarter], set: b })
      .returning();
    await audit(c, { action: "tds.return_filed", entity: "tds_return", entityId: row!.id, summary: `Recorded 24Q ${quarter} FY ${fy} filed on ${fmtDate(b.filedOn)}` });
    return c.json(row);
  },
);

/** 24Q deductee annexure (one line per employee per month) to prepare the return in the NSDL RPU. */
tdsRoutes.get("/returns/:fy/:quarter/annexure.csv", requirePerm("tds", "export"), async (c) => {
  const { fy, quarter } = c.req.param();
  if (!QUARTERS[quarter]) throw badRequest("Unknown quarter");
  const db = c.get("db");
  const qm = fyMonths(fy).filter((m) => quarterOf(m) === quarter);
  const rows = await db
    .select({ item: payrollItems, month: payrollRuns.month, payDate: payrollRuns.payDate })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, ["approved", "paid"]), inArray(payrollRuns.month, qm)))
    .orderBy(asc(payrollRuns.month), asc(sql`${payrollItems.snapshot}->>'code'`));
  const challans = await db.select().from(statutoryChallans).where(and(eq(statutoryChallans.tenantId, tid(c)), eq(statutoryChallans.statute, "tds"), inArray(statutoryChallans.period, qm)));
  const csv = toCsv(
    ["Month", "Employee ID", "PAN of deductee", "Name", "Section", "Date of payment/credit", "Amount paid/credited", "TDS deducted", "Date of deduction", "Challan CIN / reference", "Date of deposit", "Regime (115BAC)"],
    rows.map((r) => {
      const ch = challans.find((x) => x.period === r.month);
      return [r.month, r.item.snapshot.code, r.item.snapshot.pan ?? "PANNOTAVBL", r.item.snapshot.name, "192", r.payDate ?? "", Number(r.item.taxableGross), Number(r.item.tds), r.payDate ?? "", ch?.reference ?? "", ch?.paidOn ?? "", r.item.snapshot.regime === "old" ? "No" : "Yes"];
    }),
  );
  await audit(c, { action: "tds.annexure", entity: "tds_return", summary: `Exported 24Q ${quarter} annexure for FY ${fy}` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="24Q-${fy}-${quarter}.csv"` });
});

tdsRoutes.get("/form16", requirePerm("tds", "view"), v("query", fyQuery), async (c) => {
  const db = c.get("db");
  const fy = c.req.valid("query").fy ?? currentFy();
  const months = fyMonths(fy);
  const runs = await db.select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, ["approved", "paid"]), inArray(payrollRuns.month, months)));
  const closed = runs.some((r) => r.month === months[11]);
  const filed = await db.select().from(tdsReturns).where(and(eq(tdsReturns.tenantId, tid(c)), eq(tdsReturns.fy, fy)));
  const emps = await db
    .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, pan: employees.pan, gross: sql<number>`sum(${payrollItems.taxableGross})::float`, tds: sql<number>`sum(${payrollItems.tds})::float` })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, ["approved", "paid"]), inArray(payrollRuns.month, months)))
    .groupBy(employees.id, employees.fullName, employees.employeeCode, employees.pan)
    .orderBy(asc(employees.fullName));
  return c.json({ fy, closed, lockedMonths: runs.length, q4Filed: filed.some((f) => f.quarter === "Q4"), quartersFiled: filed.map((f) => f.quarter), employees: emps });
});

tdsRoutes.get("/form16/:employeeId", requirePerm("tds", "view"), v("query", fyQuery), async (c) => {
  const data = await form16(c.get("db"), tid(c), c.req.param("employeeId"), c.req.valid("query").fy ?? currentFy());
  if (!data) throw notFound("Employee");
  return c.json(data);
});

// ---------------------------------------------------------------------------
// Self-service
// ---------------------------------------------------------------------------
export const essTaxRoutes = new Hono<AppEnv>();
essTaxRoutes.use("*", requireEmployee);
const me = (c: Context<AppEnv>) => ({ tid: c.get("tenant").tenantId, eid: c.get("tenant").employeeId! });

essTaxRoutes.get("/", v("query", fyQuery), async (c) => {
  const fy = c.req.valid("query").fy ?? currentFy();
  const { tid: t, eid } = me(c);
  const r = await employeeTax(c.get("db"), t, eid, fy);
  if (!r) throw notFound("Employee");
  const proofs = r.declaration ? await c.get("db").select().from(taxProofs).where(eq(taxProofs.declarationId, r.declaration.id)).orderBy(asc(taxProofs.createdAt)) : [];
  return c.json({ ...r, fy, proofs, editable: r.declaration?.status !== "verified", sections: TAX_SECTION_LABELS });
});

/** Live what-if: compute both regimes for a draft declaration without saving it. */
essTaxRoutes.post("/preview", v("json", z.object({ fy: z.string().optional(), data: taxDeclarationDataSchema })), async (c) => {
  const b = c.req.valid("json");
  const { tid: t, eid } = me(c);
  const r = await employeeTax(c.get("db"), t, eid, b.fy ?? currentFy());
  if (!r) throw notFound("Employee");
  const sum = (k: "gross" | "basic" | "hra" | "pf" | "pt") => r.months.reduce((s, m) => s + m[k], 0);
  const cmp = compareRegimes({ financialYear: r.statement.financialYear, salary: { gross: sum("gross"), basic: sum("basic"), hra: sum("hra") }, employeePf: sum("pf"), professionalTax: sum("pt"), declaration: b.data, verified: r.declaration?.verified });
  return c.json({ new: cmp.new, old: cmp.old, better: cmp.better, saving: cmp.saving });
});

essTaxRoutes.put("/", v("json", z.object({ fy: z.string().optional(), regime: z.enum(["new", "old"]), data: taxDeclarationDataSchema })), async (c) => {
  const b = c.req.valid("json");
  const fy = b.fy ?? currentFy();
  const { tid: t, eid } = me(c);
  const db = c.get("db");
  const [cur] = await db.select().from(taxDeclarations).where(and(eq(taxDeclarations.tenantId, t), eq(taxDeclarations.employeeId, eid), eq(taxDeclarations.fy, fy)));
  if (cur?.status === "verified") throw badRequest("HR has verified and locked your declaration. Contact HR to change it.");
  const row = await upsertDeclaration(db, t, eid, fy, { regime: b.regime, data: b.data as TaxDeclarationData });
  if (fy === currentFy()) await db.update(employees).set({ taxRegime: b.regime }).where(eq(employees.id, eid));
  await audit(c, { action: "tds.declaration_save", entity: "tax_declaration", entityId: row.id, summary: `Saved tax declaration for FY ${fy} (${b.regime} regime)` });
  return c.json(row);
});

essTaxRoutes.post("/submit", v("json", fyQuery), async (c) => {
  const fy = c.req.valid("json").fy ?? currentFy();
  const { tid: t, eid } = me(c);
  const db = c.get("db");
  const [cur] = await db.select().from(taxDeclarations).where(and(eq(taxDeclarations.tenantId, t), eq(taxDeclarations.employeeId, eid), eq(taxDeclarations.fy, fy)));
  if (!cur) throw badRequest("Save your declaration first");
  if (cur.status === "verified") throw badRequest("Your declaration is already verified and locked");
  const [row] = await db.update(taxDeclarations).set({ status: "submitted", submittedAt: new Date() }).where(eq(taxDeclarations.id, cur.id)).returning();
  await audit(c, { action: "tds.declaration_submit", entity: "tax_declaration", entityId: cur.id, summary: `Submitted tax declaration for FY ${fy}` });
  return c.json(row);
});

essTaxRoutes.post("/proofs", async (c) => {
  const { tid: t, eid } = me(c);
  const db = c.get("db");
  const form = await c.req.formData();
  const file = form.get("file");
  const section = sectionSchema.safeParse(form.get("section"));
  const fy = String(form.get("fy") || currentFy());
  if (!section.success) throw badRequest("Pick the section this proof is for");
  if (!(file instanceof File)) throw badRequest("Attach a file");
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest("Files must be 10 MB or smaller");
  if (!ALLOWED_TYPES.includes(file.type)) throw badRequest("Upload a PDF, PNG, JPG or WebP file");
  const [cur] = await db.select().from(taxDeclarations).where(and(eq(taxDeclarations.tenantId, t), eq(taxDeclarations.employeeId, eid), eq(taxDeclarations.fy, fy)));
  const decl = cur ?? (await upsertDeclaration(db, t, eid, fy, {}));
  if (decl.status === "verified") throw badRequest("Your declaration is locked");
  const key = `tenants/${t}/tax/${fy}/${eid}/${crypto.randomUUID()}-${safeName(file.name)}`;
  await putFile(c.env, key, await file.arrayBuffer(), file.type);
  const [row] = await db.insert(taxProofs).values({ tenantId: t, declarationId: decl.id, section: section.data, fileKey: key, fileName: file.name, mimeType: file.type, sizeBytes: file.size }).returning();
  await audit(c, { action: "tds.proof_upload", entity: "tax_proof", entityId: row!.id, summary: `Uploaded ${TAX_SECTION_LABELS[section.data as TaxSection]} proof` });
  return c.json(row, 201);
});

async function myProof(c: Context<AppEnv>) {
  const { tid: t, eid } = me(c);
  const [p] = await c
    .get("db")
    .select({ p: taxProofs })
    .from(taxProofs)
    .innerJoin(taxDeclarations, eq(taxDeclarations.id, taxProofs.declarationId))
    .where(and(eq(taxProofs.id, c.req.param("id")!), eq(taxProofs.tenantId, t), eq(taxDeclarations.employeeId, eid)));
  if (!p) throw notFound("Proof");
  return p.p;
}

essTaxRoutes.get("/proofs/:id/file", async (c) => sendProofFile(c, await myProof(c)));

essTaxRoutes.delete("/proofs/:id", async (c) => {
  const p = await myProof(c);
  if (p.status !== "pending") throw badRequest("HR has already reviewed this proof");
  await c.get("db").delete(taxProofs).where(eq(taxProofs.id, p.id));
  await deleteFile(c.env, p.fileKey);
  return c.json({ ok: true });
});

essTaxRoutes.get("/form16", v("query", fyQuery), async (c) => {
  const { tid: t, eid } = me(c);
  // default: the last completed financial year
  const start = Number(currentFy().slice(0, 4)) - 1;
  const fy = c.req.valid("query").fy ?? `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  const data = await form16(c.get("db"), t, eid, fy);
  // No salary from us in that FY: nothing to certify (200 + null keeps the console quiet)
  return c.json(data && data.period.from ? data : null);
});

