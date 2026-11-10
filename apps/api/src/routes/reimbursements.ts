import { Hono, type Context } from "hono";
import { sendNotification } from "../services/notifications";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { claimReceipts, departments, employees, paymentBatches, payments, payrollRuns, reimbursementCategories, reimbursementClaims, tenants } from "@hrms/db";
import { bulkDecisionSchema, claimCreateSchema, decisionSchema, inr, reimbursementCategorySchema, todayIST } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { layout } from "../lib/email";
import { ALLOWED_TYPES, getFile, MAX_UPLOAD_BYTES, putFile, safeName } from "../lib/storage";
import { canDecide, claimAmount, initialStatus, isOrgWide, nextClaimCode, nextStatus, OPEN, overLimit, type Claim } from "../services/reimbursements";
import { monthLabel } from "../lib/months";

export const reimbursementRoutes = new Hono<AppEnv>();
export const essClaimRoutes = new Hono<AppEnv>();
essClaimRoutes.use("*", requireEmployee);

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;

export const STATUS_LABEL: Record<string, string> = {
  pending_manager: "With manager",
  pending_finance: "With finance",
  approved: "Approved, unpaid",
  paid: "Paid",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
reimbursementRoutes.get("/categories", requirePerm("reimbursements", "view"), async (c) =>
  c.json(await c.get("db").select().from(reimbursementCategories).where(eq(reimbursementCategories.tenantId, tid(c))).orderBy(asc(reimbursementCategories.name))),
);

reimbursementRoutes.post("/categories", requirePerm("reimbursements", "configure"), v("json", reimbursementCategorySchema), async (c) => {
  const b = c.req.valid("json");
  if (b.limitPeriod === "km" && !b.ratePerKm) throw badRequest("Set a rate per km");
  const [row] = await c.get("db").insert(reimbursementCategories).values({ ...b, tenantId: tid(c) }).returning();
  await audit(c, { action: "reimb.category_create", entity: "reimbursement_category", entityId: row!.id, summary: `Added expense category ${b.name}` });
  return c.json(row, 201);
});

reimbursementRoutes.patch("/categories/:id", requirePerm("reimbursements", "configure"), vPatch(reimbursementCategorySchema.partial()), async (c) => {
  const [row] = await c
    .get("db")
    .update(reimbursementCategories)
    .set(c.req.valid("json"))
    .where(and(eq(reimbursementCategories.id, c.req.param("id")), eq(reimbursementCategories.tenantId, tid(c))))
    .returning();
  if (!row) throw notFound("Category");
  await audit(c, { action: "reimb.category_update", entity: "reimbursement_category", entityId: row.id, summary: `Updated expense category ${row.name}`, data: c.req.valid("json") });
  return c.json(row);
});

// ---------------------------------------------------------------------------
// Claims: shared helpers
// ---------------------------------------------------------------------------
const mgr = alias(employees, "mgr");
function claimSelect() {
  return {
    claim: reimbursementClaims,
    employeeName: employees.fullName,
    employeeCode: employees.employeeCode,
    managerId: employees.managerId,
    managerName: mgr.fullName,
    department: departments.name,
    category: reimbursementCategories.name,
    approval: reimbursementCategories.approval,
    runMonth: payrollRuns.month,
    batchCode: paymentBatches.code,
    receipts: sql<number>`(select count(*)::int from claim_receipts r where r.claim_id = "reimbursement_claims"."id")`,
  };
}
type Row = { claim: Claim; employeeName: string; employeeCode: string; managerId: string | null; managerName: string | null; department: string | null; category: string; approval: string; runMonth: string | null; batchCode: string | null; receipts: number };
const shape = (r: Row) => ({
  ...r.claim,
  employeeName: r.employeeName,
  employeeCode: r.employeeCode,
  managerName: r.managerName,
  department: r.department,
  category: r.category,
  approval: r.approval,
  statusLabel: STATUS_LABEL[r.claim.status] ?? r.claim.status,
  payment: r.batchCode
    ? r.claim.status === "paid"
      ? `Paid in batch ${r.batchCode}`
      : `In payment batch ${r.batchCode}`
    : r.claim.status === "paid"
      ? `Paid with ${r.runMonth ? monthLabel(r.runMonth) + " salary" : "salary"}`
      : r.runMonth
        ? `In ${monthLabel(r.runMonth)} payroll`
        : r.claim.status === "approved"
          ? "Next payroll"
          : null,
  receipts: r.receipts,
});

function baseQuery(c: Context<AppEnv>, conds: SQL[]) {
  return c
    .get("db")
    .select(claimSelect())
    .from(reimbursementClaims)
    .innerJoin(employees, eq(employees.id, reimbursementClaims.employeeId))
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .innerJoin(reimbursementCategories, eq(reimbursementCategories.id, reimbursementClaims.categoryId))
    .leftJoin(payrollRuns, eq(payrollRuns.id, reimbursementClaims.payrollRunId))
    .leftJoin(payments, eq(payments.id, reimbursementClaims.paymentId))
    .leftJoin(paymentBatches, eq(paymentBatches.id, payments.batchId))
    .where(and(eq(reimbursementClaims.tenantId, tid(c)), ...conds));
}

/** Org-wide roles see everything; managers see their direct reports. */
function scopeConds(c: Context<AppEnv>): SQL[] {
  const t = c.get("tenant");
  if (isOrgWide(t.permissions)) return [];
  return [eq(employees.managerId, t.employeeId ?? "-")];
}

/** Create a claim from a multipart form (field "data" = JSON, "files" = receipts). */
async function createClaim(c: Context<AppEnv>, employeeId: string, form: FormData) {
  const db = c.get("db");
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("data") ?? "{}"));
  } catch {
    throw badRequest("Invalid claim data");
  }
  const parsed = claimCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw badRequest(i ? `${i.path.join(".")}: ${i.message}` : "Invalid claim", parsed.error.issues);
  }
  const b = parsed.data;
  const [cat] = await db.select().from(reimbursementCategories).where(and(eq(reimbursementCategories.id, b.categoryId), eq(reimbursementCategories.tenantId, tid(c))));
  if (!cat || !cat.active) throw badRequest("Pick a valid category");
  if (b.expenseDate > todayIST()) throw badRequest("The expense date can't be in the future");
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tid(c))));
  if (!emp) throw notFound("Employee");
  if (b.expenseDate < emp.dateOfJoining) throw badRequest("The expense is from before the employee joined");
  if (cat.limitPeriod === "km" && !b.km) throw badRequest("Enter the distance in km");
  const amount = claimAmount(cat, b);
  if (amount <= 0) throw badRequest("Enter the amount");
  if (b.gstAmount && b.gstAmount > amount) throw badRequest("GST can't be more than the claim amount");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (amount > Number(cat.receiptRequiredAbove) && files.length === 0) throw badRequest(`Attach a receipt for ${cat.name} claims above ${inr(Number(cat.receiptRequiredAbove))}`);
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) throw badRequest("Receipts must be 10 MB or smaller");
    if (!ALLOWED_TYPES.includes(f.type)) throw badRequest("Receipts must be PDF, PNG, JPG or WebP");
  }
  // duplicate guard: same employee, category, date and amount still open or approved
  const [dup] = await db
    .select({ code: reimbursementClaims.code })
    .from(reimbursementClaims)
    .where(and(eq(reimbursementClaims.tenantId, tid(c)), eq(reimbursementClaims.employeeId, emp.id), eq(reimbursementClaims.categoryId, cat.id), eq(reimbursementClaims.expenseDate, b.expenseDate), eq(reimbursementClaims.amount, amount), inArray(reimbursementClaims.status, [...OPEN, "approved", "paid"])));
  if (dup) throw badRequest(`This looks like a duplicate of ${dup.code}`);
  const limit = await overLimit(db, tid(c), cat, emp.id, b.expenseDate, amount);
  const status = initialStatus(cat, !!emp.managerId);
  const code = await nextClaimCode(db, tid(c));
  const [claim] = await db
    .insert(reimbursementClaims)
    .values({ tenantId: tid(c), code, employeeId: emp.id, categoryId: cat.id, expenseDate: b.expenseDate, amount, km: b.km ?? null, vendor: b.vendor ?? null, gstin: cat.gstCapture ? (b.gstin ?? null) : null, gstAmount: cat.gstCapture ? (b.gstAmount ?? null) : null, project: b.project ?? null, description: b.description, status, overLimit: limit.over })
    .returning();
  for (const f of files) {
    const key = `tenants/${tid(c)}/claims/${claim!.id}/${crypto.randomUUID()}-${safeName(f.name)}`;
    await putFile(c.env, key, await f.arrayBuffer(), f.type);
    await db.insert(claimReceipts).values({ tenantId: tid(c), claimId: claim!.id, fileKey: key, fileName: f.name, mimeType: f.type, sizeBytes: f.size });
  }
  await audit(c, { action: "reimb.claim_create", entity: "reimbursement_claim", entityId: claim!.id, summary: `${code}: ${cat.name} ${inr(amount)} for ${emp.fullName}${limit.over ? " (over policy limit)" : ""}` });
  return { claim: claim!, overLimit: limit };
}

async function notifyDecision(c: Context<AppEnv>, claim: Claim, decision: "approved" | "rejected", final: boolean) {
  if (decision === "approved" && !final) return;
  try {
    const [e] = await c.get("db").select({ email: employees.workEmail, first: employees.firstName, company: tenants.name }).from(employees).innerJoin(tenants, eq(tenants.id, employees.tenantId)).where(eq(employees.id, claim.employeeId));
    if (!e) return;
    const ok = decision === "approved";
    const { html, text } = layout({
      company: e.company,
      heading: `Claim ${claim.code} ${ok ? "approved" : "not approved"}`,
      paragraphs: [`Hi ${e.first},`, ok ? `Your claim of ${inr(Number(claim.amount))} is approved and will be paid with your next salary.` : `Your claim of ${inr(Number(claim.amount))} was rejected.`, ...(claim.rejectionReason ? [`Reason: ${claim.rejectionReason}`] : [])],
      cta: { label: "View my claims", url: `${c.env.APP_URL}/me/claims` },
    });
    await sendNotification(c, "claim_decision", { to: e.email, subject: `Claim ${claim.code} ${ok ? "approved" : "rejected"}`, html, text });
  } catch (err) {
    console.error("claim email failed", err);
  }
}

async function decide(c: Context<AppEnv>, id: string, decision: "approved" | "rejected", note?: string | null) {
  const db = c.get("db");
  const [claim] = await db.select().from(reimbursementClaims).where(and(eq(reimbursementClaims.id, id), eq(reimbursementClaims.tenantId, tid(c))));
  if (!claim) throw notFound("Claim");
  const why = await canDecide(db, claim, c.get("tenant"));
  if (why) throw why.includes("already") ? badRequest(why) : forbidden(why);
  if (decision === "rejected" && !note) throw badRequest("Add a reason for rejecting");
  const [cat] = await db.select().from(reimbursementCategories).where(eq(reimbursementCategories.id, claim.categoryId));
  const now = new Date();
  const patch: Partial<Claim> =
    decision === "rejected"
      ? { status: "rejected", rejectedBy: uid(c), rejectedAt: now, rejectionReason: note ?? null }
      : claim.status === "pending_manager"
        ? { status: nextStatus(claim, cat!), managerApprovedBy: uid(c), managerApprovedAt: now }
        : { status: "approved", financeApprovedBy: uid(c), financeApprovedAt: now };
  const [row] = await db.update(reimbursementClaims).set(patch).where(and(eq(reimbursementClaims.id, id), eq(reimbursementClaims.status, claim.status))).returning();
  if (!row) throw badRequest("This claim changed. Reload and try again.");
  await audit(c, { action: `reimb.claim_${decision}`, entity: "reimbursement_claim", entityId: id, summary: `${decision === "approved" ? "Approved" : "Rejected"} ${claim.code} at ${claim.status === "pending_manager" ? "manager" : "finance"} stage`, data: note ? { note } : undefined });
  await notifyDecision(c, row, decision, row.status === "approved");
  return row;
}

// ---------------------------------------------------------------------------
// Admin queue, history, summary
// ---------------------------------------------------------------------------
const listQuery = z.object({ status: z.string().optional(), q: z.string().optional(), categoryId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), mine: z.enum(["1"]).optional() });

function listConds(c: Context<AppEnv>, q: z.infer<typeof listQuery>) {
  const conds = scopeConds(c);
  if (q.status) conds.push(inArray(reimbursementClaims.status, q.status.split(",")));
  if (q.categoryId) conds.push(eq(reimbursementClaims.categoryId, q.categoryId));
  if (q.from) conds.push(gte(reimbursementClaims.expenseDate, q.from));
  if (q.to) conds.push(lte(reimbursementClaims.expenseDate, q.to));
  if (q.q) conds.push(or(ilike(employees.fullName, `%${q.q}%`), ilike(employees.employeeCode, `%${q.q}%`), ilike(reimbursementClaims.code, `%${q.q}%`), ilike(reimbursementClaims.project, `%${q.q}%`))!);
  return conds;
}

reimbursementRoutes.get("/claims", requirePerm("reimbursements", "view"), v("query", listQuery), async (c) => {
  const q = c.req.valid("query");
  const t = c.get("tenant");
  const rows = (await baseQuery(c, listConds(c, q)).orderBy(desc(reimbursementClaims.createdAt)).limit(1000)) as Row[];
  // "mine": what this user can act on right now
  let list = rows.map(shape);
  if (q.mine) {
    const out = [];
    for (const r of rows) if (!(await canDecide(c.get("db"), r.claim, t))) out.push(shape(r));
    list = out;
  }
  return c.json(list);
});

reimbursementRoutes.get("/summary", requirePerm("reimbursements", "view"), async (c) => {
  const month = todayIST().slice(0, 7);
  const rows = (await baseQuery(c, [])) as Row[];
  const sum = (f: (r: Row) => boolean) => rows.filter(f).reduce((s, r) => s + Number(r.claim.amount), 0);
  const fyStart = `${Number(month.slice(5)) >= 4 ? month.slice(0, 4) : Number(month.slice(0, 4)) - 1}-04-01`;
  return c.json({
    pending: { amount: sum((r) => (OPEN as readonly string[]).includes(r.claim.status)), count: rows.filter((r) => (OPEN as readonly string[]).includes(r.claim.status)).length },
    withManager: rows.filter((r) => r.claim.status === "pending_manager").length,
    withFinance: rows.filter((r) => r.claim.status === "pending_finance").length,
    approvedUnpaid: { amount: sum((r) => r.claim.status === "approved"), count: rows.filter((r) => r.claim.status === "approved").length },
    paidThisMonth: { amount: sum((r) => r.claim.status === "paid" && !!r.claim.paidAt && r.claim.paidAt.toISOString().slice(0, 7) === month), count: rows.filter((r) => r.claim.status === "paid" && !!r.claim.paidAt && r.claim.paidAt.toISOString().slice(0, 7) === month).length },
    gstCredit: rows.filter((r) => r.claim.gstin && ["approved", "paid"].includes(r.claim.status) && r.claim.expenseDate >= fyStart).reduce((s, r) => s + Number(r.claim.gstAmount ?? 0), 0),
    overLimit: rows.filter((r) => r.claim.overLimit && (OPEN as readonly string[]).includes(r.claim.status)).length,
  });
});

reimbursementRoutes.get("/claims/:id", requirePerm("reimbursements", "view"), async (c) => {
  const rows = (await baseQuery(c, [...scopeConds(c), eq(reimbursementClaims.id, c.req.param("id"))])) as Row[];
  if (!rows[0]) throw notFound("Claim");
  const receipts = await c.get("db").select().from(claimReceipts).where(eq(claimReceipts.claimId, rows[0].claim.id));
  const blocked = await canDecide(c.get("db"), rows[0].claim, c.get("tenant"));
  return c.json({ ...shape(rows[0]), receiptFiles: receipts, canDecide: !blocked, blockedReason: blocked });
});

reimbursementRoutes.post("/claims", requirePerm("reimbursements", "edit"), async (c) => {
  const form = await c.req.formData();
  let employeeId = "";
  try {
    employeeId = JSON.parse(String(form.get("data") ?? "{}")).employeeId ?? "";
  } catch {
    /* validated in createClaim */
  }
  if (!employeeId) throw badRequest("Pick the employee");
  const r = await createClaim(c, employeeId, form);
  return c.json(r, 201);
});

reimbursementRoutes.post("/claims/:id/decision", requirePerm("reimbursements", "approve"), v("json", decisionSchema), async (c) => {
  const b = c.req.valid("json");
  return c.json(await decide(c, c.req.param("id"), b.decision, b.note));
});

reimbursementRoutes.post("/claims/bulk-decision", requirePerm("reimbursements", "approve"), v("json", bulkDecisionSchema), async (c) => {
  const b = c.req.valid("json");
  const errors: { id: string; message: string }[] = [];
  for (const id of b.ids) {
    try {
      await decide(c, id, b.decision, b.note);
    } catch (e) {
      errors.push({ id, message: (e as Error).message });
    }
  }
  return c.json({ done: b.ids.length - errors.length, errors });
});

async function sendReceipt(c: Context<AppEnv>, receiptId: string, claimConds: SQL[]) {
  const [r] = await c
    .get("db")
    .select({ r: claimReceipts })
    .from(claimReceipts)
    .innerJoin(reimbursementClaims, eq(reimbursementClaims.id, claimReceipts.claimId))
    .innerJoin(employees, eq(employees.id, reimbursementClaims.employeeId))
    .where(and(eq(claimReceipts.id, receiptId), eq(claimReceipts.tenantId, tid(c)), ...claimConds));
  if (!r) throw notFound("Receipt");
  const file = await getFile(c.env, r.r.fileKey);
  if (!file) throw notFound("File");
  return new Response(file.body as BodyInit, { headers: { "Content-Type": file.type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.r.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

reimbursementRoutes.get("/receipts/:id", requirePerm("reimbursements", "view"), (c) => sendReceipt(c, c.req.param("id"), scopeConds(c)));

reimbursementRoutes.get("/export.csv", requirePerm("reimbursements", "export"), v("query", listQuery), async (c) => {
  const rows = ((await baseQuery(c, listConds(c, c.req.valid("query"))).orderBy(asc(reimbursementClaims.expenseDate))) as Row[]).map(shape);
  const csv = toCsv(
    ["Claim", "Employee ID", "Employee", "Department", "Category", "Expense date", "Amount", "Vendor", "GSTIN", "GST amount", "Project / client", "Description", "Status", "Over limit", "Payment"],
    rows.map((r) => [r.code, r.employeeCode, r.employeeName, r.department, r.category, r.expenseDate, Number(r.amount), r.vendor, r.gstin, r.gstAmount, r.project, r.description, r.statusLabel, r.overLimit ? "Yes" : "", r.payment]),
  );
  await audit(c, { action: "reimb.export", entity: "reimbursement_claim", summary: `Exported ${rows.length} claims` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="reimbursements-${todayIST()}.csv"` });
});

// ---------------------------------------------------------------------------
// Self-service
// ---------------------------------------------------------------------------
const myId = (c: Context<AppEnv>) => c.get("tenant").employeeId!;

essClaimRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = ((await baseQuery(c, [eq(reimbursementClaims.employeeId, myId(c))]).orderBy(desc(reimbursementClaims.createdAt)).limit(200)) as Row[]).map(shape);
  const categories = await db.select().from(reimbursementCategories).where(and(eq(reimbursementCategories.tenantId, tid(c)), eq(reimbursementCategories.active, true))).orderBy(asc(reimbursementCategories.name));
  const month = todayIST().slice(0, 7);
  const usage = categories
    .filter((cat) => cat.limitPeriod === "month" && cat.limitAmount !== null)
    .map((cat) => ({ categoryId: cat.id, name: cat.name, limit: Number(cat.limitAmount), used: rows.filter((r) => r.categoryId === cat.id && r.expenseDate.startsWith(month) && !["rejected", "cancelled"].includes(r.status)).reduce((s, r) => s + Number(r.amount), 0) }));
  return c.json({ claims: rows, categories, usage, month });
});

essClaimRoutes.post("/", async (c) => {
  const r = await createClaim(c, myId(c), await c.req.formData());
  return c.json(r, 201);
});

essClaimRoutes.get("/:id", async (c) => {
  const rows = (await baseQuery(c, [eq(reimbursementClaims.employeeId, myId(c)), eq(reimbursementClaims.id, c.req.param("id"))])) as Row[];
  if (!rows[0]) throw notFound("Claim");
  const receipts = await c.get("db").select().from(claimReceipts).where(eq(claimReceipts.claimId, rows[0].claim.id));
  return c.json({ ...shape(rows[0]), receiptFiles: receipts });
});

essClaimRoutes.post("/:id/cancel", async (c) => {
  const db = c.get("db");
  const [row] = await db
    .update(reimbursementClaims)
    .set({ status: "cancelled" })
    .where(and(eq(reimbursementClaims.id, c.req.param("id")), eq(reimbursementClaims.tenantId, tid(c)), eq(reimbursementClaims.employeeId, myId(c)), inArray(reimbursementClaims.status, [...OPEN])))
    .returning();
  if (!row) throw badRequest("Only claims still waiting for approval can be cancelled");
  await audit(c, { action: "reimb.claim_cancel", entity: "reimbursement_claim", entityId: row.id, summary: `Cancelled ${row.code}` });
  return c.json(row);
});

essClaimRoutes.get("/receipts/:id", (c) => sendReceipt(c, c.req.param("id"), [eq(reimbursementClaims.employeeId, myId(c))]));
