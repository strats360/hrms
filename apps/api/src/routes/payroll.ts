import { Hono, type Context } from "hono";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  attendanceCorrections,
  employees,
  leaveRequests,
  payrollAdjustments,
  payrollItems,
  payrollRuns,
  salaryStructures,
  tenants,
  user,
} from "@hrms/db";
import {
  can,
  decryptField,
  markPaidSchema,
  payrollAdjustmentSchema,
  payrollItemPatchSchema,
  payrollRunCreateSchema,
  reopenSchema,
  structureFromComponents,
  structureFromCtc,
  structureRevisionSchema,
  tenantPayrollSettingsSchema,
  todayIST,
  fmtDate,
  inr,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { layout } from "../lib/email";
import { calculateRun, defaultPayDate, getTemplate, monthBounds, payableEmployees, refreshTotals, resolveStructure, structuresAsOf } from "../services/payroll";

export const payrollRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;

// ---------------------------------------------------------------------------
// Salary template and structures
// ---------------------------------------------------------------------------
const templateSchema = tenantPayrollSettingsSchema.shape.salaryTemplate.unwrap();

payrollRoutes.get("/template", requirePerm("payroll", "view"), async (c) => c.json(await getTemplate(c.get("db"), tid(c))));

payrollRoutes.put("/template", requirePerm("payroll", "configure"), v("json", templateSchema), async (c) => {
  const db = c.get("db");
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tid(c)));
  const salaryTemplate = c.req.valid("json");
  await db.update(tenants).set({ settings: { ...(t?.settings ?? {}), salaryTemplate } }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "payroll.template", entity: "tenant", entityId: tid(c), summary: "Updated salary template", data: salaryTemplate });
  return c.json(salaryTemplate);
});

/** Preview a structure for a CTC (or custom components) with the saved or a draft template. */
payrollRoutes.post(
  "/template/preview",
  requirePerm("payroll", "view"),
  v("json", z.object({ annualCtc: z.number().min(0).max(1e9), template: templateSchema.optional(), pfApplicable: z.boolean().default(true), esiApplicable: z.boolean().default(true) })),
  async (c) => {
    const b = c.req.valid("json");
    const template = b.template ?? (await getTemplate(c.get("db"), tid(c)));
    return c.json(structureFromCtc(b.annualCtc, template, { pfApplicable: b.pfApplicable, esiApplicable: b.esiApplicable }));
  },
);

/** Current structure for every active employee. */
payrollRoutes.get("/structures", requirePerm("payroll", "view"), v("query", z.object({ q: z.string().optional() })), async (c) => {
  const db = c.get("db");
  const today = todayIST();
  const emps = (await payableEmployees(db, tid(c), today, today)).filter((x) => {
    const q = c.req.valid("query").q?.toLowerCase();
    return !q || x.e.fullName.toLowerCase().includes(q) || x.e.employeeCode.toLowerCase().includes(q);
  });
  const template = await getTemplate(db, tid(c));
  const structs = await structuresAsOf(db, tid(c), emps.map((x) => x.e.id), today);
  return c.json(
    emps
      .map(({ e, department, designation }) => {
        const row = structs.get(e.id);
        const s = resolveStructure(e, row, template);
        return { employeeId: e.id, name: e.fullName, code: e.employeeCode, department, designation, annualCtc: s.annualCtc, monthlyGross: s.gross, basic: s.components.basic, employerPf: s.employer.pf, esiApplicable: s.esiApplicable, effectiveFrom: row?.effectiveFrom ?? e.dateOfJoining, source: row?.components ? "custom" : "template" };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
});

payrollRoutes.get("/structures/:employeeId", requirePerm("payroll", "view"), async (c) => {
  const db = c.get("db");
  const [e] = await db.select().from(employees).where(and(eq(employees.id, c.req.param("employeeId")), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  const template = await getTemplate(db, tid(c));
  const history = await db.select().from(salaryStructures).where(and(eq(salaryStructures.tenantId, tid(c)), eq(salaryStructures.employeeId, e.id))).orderBy(desc(salaryStructures.effectiveFrom));
  const current = (await structuresAsOf(db, tid(c), [e.id], todayIST())).get(e.id);
  return c.json({
    employee: { id: e.id, name: e.fullName, code: e.employeeCode, dateOfJoining: e.dateOfJoining, pfApplicable: e.pfApplicable, esiApplicable: e.esiApplicable, taxRegime: e.taxRegime },
    current: resolveStructure(e, current, template),
    history: history.map((h) => ({ ...h, structure: resolveStructure(e, h, template) })),
  });
});

payrollRoutes.post("/structures/:employeeId", requirePerm("payroll", "edit"), v("json", structureRevisionSchema), async (c) => {
  const db = c.get("db");
  const b = c.req.valid("json");
  const [e] = await db.select().from(employees).where(and(eq(employees.id, c.req.param("employeeId")), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  // a structure can't change a month that's already locked
  const [locked] = await db
    .select({ month: payrollRuns.month })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, ["approved", "paid"]), gte(payrollRuns.periodEnd, b.effectiveFrom)))
    .limit(1);
  if (locked) throw badRequest(`Payroll for ${locked.month} is already locked. Use an effective date after it, and add arrears as a one-time earning.`);
  const template = await getTemplate(db, tid(c));
  const annualCtc = b.components ? structureFromComponents(b.components, template, e).annualCtc : b.annualCtc;
  const [row] = await db
    .insert(salaryStructures)
    .values({ tenantId: tid(c), employeeId: e.id, effectiveFrom: b.effectiveFrom, annualCtc, components: b.components ?? null, reason: b.reason ?? null, createdBy: uid(c) })
    .onConflictDoUpdate({ target: [salaryStructures.tenantId, salaryStructures.employeeId, salaryStructures.effectiveFrom], set: { annualCtc, components: b.components ?? null, reason: b.reason ?? null } })
    .returning();
  if (b.effectiveFrom <= todayIST()) await db.update(employees).set({ annualCtc }).where(eq(employees.id, e.id));
  await audit(c, { action: "payroll.structure", entity: "salary_structure", entityId: row!.id, summary: `Set ${e.fullName}'s CTC to ${inr(annualCtc)} from ${fmtDate(b.effectiveFrom)}`, data: { reason: b.reason } });
  return c.json(row, 201);
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------
async function loadRun(c: Context<AppEnv>, id: string) {
  const [run] = await c.get("db").select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tid(c))));
  if (!run) throw notFound("Payroll run");
  return run;
}
const names = async (c: Context<AppEnv>, ids: (string | null)[]) => {
  const list = ids.filter(Boolean) as string[];
  if (!list.length) return new Map<string, string>();
  const rows = await c.get("db").select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
};

payrollRoutes.get("/runs", requirePerm("payroll", "view"), async (c) => {
  const rows = await c.get("db").select().from(payrollRuns).where(eq(payrollRuns.tenantId, tid(c))).orderBy(desc(payrollRuns.month));
  const n = await names(c, rows.flatMap((r) => [r.calculatedBy, r.approvedBy, r.paidBy]));
  return c.json(rows.map((r) => ({ ...r, calculatedByName: n.get(r.calculatedBy ?? "") ?? null, approvedByName: n.get(r.approvedBy ?? "") ?? null, paidByName: n.get(r.paidBy ?? "") ?? null })));
});

payrollRoutes.post("/runs", requirePerm("payroll", "edit"), v("json", payrollRunCreateSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const { start, end } = monthBounds(b.month);
  const [exists] = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), eq(payrollRuns.month, b.month)));
  if (exists) throw conflict(`A payroll run for ${b.month} already exists`);
  const [open] = await db.select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, ["draft", "calculated"]), sql`${payrollRuns.month} < ${b.month}`));
  if (open) throw badRequest(`Finish the ${open.month} payroll first (approve and lock it)`);
  const [run] = await db
    .insert(payrollRuns)
    .values({ tenantId: tid(c), month: b.month, periodStart: start, periodEnd: end, payDate: b.payDate ?? defaultPayDate(b.month), preparedBy: uid(c) })
    .returning();
  await audit(c, { action: "payroll.run_create", entity: "payroll_run", entityId: run!.id, summary: `Started payroll for ${b.month}` });
  return c.json(run, 201);
});

payrollRoutes.patch("/runs/:id", requirePerm("payroll", "edit"), vPatch(z.object({ payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).partial()), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status === "approved" || run.status === "paid") throw badRequest("This payroll is locked");
  const [row] = await c.get("db").update(payrollRuns).set(c.req.valid("json")).where(eq(payrollRuns.id, run.id)).returning();
  return c.json(row);
});

payrollRoutes.delete("/runs/:id", requirePerm("payroll", "edit"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status === "approved" || run.status === "paid") throw badRequest("A locked payroll can't be deleted");
  await c.get("db").delete(payrollRuns).where(eq(payrollRuns.id, run.id));
  await audit(c, { action: "payroll.run_delete", entity: "payroll_run", entityId: run.id, summary: `Discarded draft payroll for ${run.month}` });
  return c.json({ ok: true });
});

payrollRoutes.get("/runs/:id", requirePerm("payroll", "view"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const db = c.get("db");
  const n = await names(c, [run.calculatedBy, run.approvedBy, run.paidBy, run.preparedBy]);
  const [prev] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), sql`${payrollRuns.month} < ${run.month}`)).orderBy(desc(payrollRuns.month)).limit(1);
  return c.json({
    ...run,
    preparedByName: n.get(run.preparedBy ?? "") ?? null,
    calculatedByName: n.get(run.calculatedBy ?? "") ?? null,
    approvedByName: n.get(run.approvedBy ?? "") ?? null,
    paidByName: n.get(run.paidBy ?? "") ?? null,
    previous: prev ? { id: prev.id, month: prev.month, status: prev.status, totals: prev.totals, approvedAt: prev.approvedAt } : null,
  });
});

/** Step 2 + 3 checks: who's in, joiners, exits, revisions, missing data and blockers. */
payrollRoutes.get("/runs/:id/inputs", requirePerm("payroll", "view"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const db = c.get("db");
  const emps = await payableEmployees(db, tid(c), run.periodStart, run.periodEnd);
  const ids = emps.map((x) => x.e.id);
  const [revised, corr, pendingLeave, adj] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(salaryStructures).where(and(eq(salaryStructures.tenantId, tid(c)), gte(salaryStructures.effectiveFrom, run.periodStart), lte(salaryStructures.effectiveFrom, run.periodEnd))),
    db.select({ n: sql<number>`count(*)::int` }).from(attendanceCorrections).where(and(eq(attendanceCorrections.tenantId, tid(c)), eq(attendanceCorrections.status, "pending"), gte(attendanceCorrections.date, run.periodStart), lte(attendanceCorrections.date, run.periodEnd))),
    db.select({ n: sql<number>`count(*)::int` }).from(leaveRequests).where(and(eq(leaveRequests.tenantId, tid(c)), eq(leaveRequests.status, "pending"), lte(leaveRequests.startDate, run.periodEnd), gte(leaveRequests.endDate, run.periodStart))),
    db.select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(case when kind='earning' then amount else -amount end),0)::float` }).from(payrollAdjustments).where(eq(payrollAdjustments.runId, run.id)),
  ]);
  const joiners = emps.filter((x) => x.e.dateOfJoining >= run.periodStart);
  const exits = emps.filter((x) => x.e.lastWorkingDay && x.e.lastWorkingDay <= run.periodEnd);
  return c.json({
    employees: ids.length,
    joiners: joiners.map((x) => ({ id: x.e.id, name: x.e.fullName, date: x.e.dateOfJoining })),
    exits: exits.map((x) => ({ id: x.e.id, name: x.e.fullName, date: x.e.lastWorkingDay })),
    structuresRevised: revised[0]?.n ?? 0,
    missingBank: emps.filter((x) => !x.e.accountLast4 || !x.e.ifsc).map((x) => ({ id: x.e.id, name: x.e.fullName })),
    missingPan: emps.filter((x) => !x.e.pan).map((x) => ({ id: x.e.id, name: x.e.fullName })),
    pendingCorrections: corr[0]?.n ?? 0,
    pendingLeave: pendingLeave[0]?.n ?? 0,
    adjustments: { count: adj[0]?.n ?? 0, net: adj[0]?.total ?? 0 },
  });
});

payrollRoutes.post("/runs/:id/calculate", requirePerm("payroll", "edit"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const count = await calculateRun(c.get("db"), tid(c), run.id, uid(c));
  await audit(c, { action: "payroll.calculate", entity: "payroll_run", entityId: run.id, summary: `Calculated ${run.month} payroll for ${count} employees` });
  return c.json(await loadRun(c, run.id));
});

const itemsQuery = z.object({ q: z.string().optional(), department: z.string().optional(), filter: z.enum(["all", "exceptions", "lop", "hold"]).default("all") });

payrollRoutes.get("/runs/:id/items", requirePerm("payroll", "view"), v("query", itemsQuery), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const q = c.req.valid("query");
  const conds = [eq(payrollItems.runId, run.id)];
  if (q.q) conds.push(or(ilike(sql`${payrollItems.snapshot}->>'name'`, `%${q.q}%`), ilike(sql`${payrollItems.snapshot}->>'code'`, `%${q.q}%`))!);
  if (q.department) conds.push(sql`${payrollItems.snapshot}->>'department' = ${q.department}`);
  if (q.filter === "exceptions") conds.push(or(sql`cardinality(${payrollItems.warnings}) > 0`, eq(payrollItems.onHold, true))!);
  if (q.filter === "lop") conds.push(sql`coalesce(${payrollItems.lopOverride}, ${payrollItems.lopDays}) > 0`);
  if (q.filter === "hold") conds.push(eq(payrollItems.onHold, true));
  const rows = await c.get("db").select().from(payrollItems).where(and(...conds)).orderBy(asc(sql`${payrollItems.snapshot}->>'name'`));
  const prevRun = (await c.get("db").select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), sql`${payrollRuns.month} < ${run.month}`)).orderBy(desc(payrollRuns.month)).limit(1))[0];
  const prevNet = prevRun
    ? new Map((await c.get("db").select({ e: payrollItems.employeeId, net: payrollItems.net }).from(payrollItems).where(eq(payrollItems.runId, prevRun.id))).map((r) => [r.e, Number(r.net)]))
    : new Map<string, number>();
  const adj = await c.get("db").select().from(payrollAdjustments).where(eq(payrollAdjustments.runId, run.id));
  return c.json(rows.map((r) => ({ ...r, previousNet: prevNet.get(r.employeeId) ?? null, adjustments: adj.filter((a) => a.employeeId === r.employeeId) })));
});

payrollRoutes.get("/runs/:id/items/:employeeId", requirePerm("payroll", "view"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const [item] = await c.get("db").select().from(payrollItems).where(and(eq(payrollItems.runId, run.id), eq(payrollItems.employeeId, c.req.param("employeeId"))));
  if (!item) throw notFound("Payslip");
  return c.json(await payslipView(c, run, item));
});

payrollRoutes.patch("/runs/:id/items/:employeeId", requirePerm("payroll", "edit"), vPatch(payrollItemPatchSchema), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "calculated") throw badRequest(run.status === "draft" ? "Calculate the payroll first" : "This payroll is locked");
  const b = c.req.valid("json");
  const db = c.get("db");
  const [item] = await db.update(payrollItems).set(b).where(and(eq(payrollItems.runId, run.id), eq(payrollItems.employeeId, c.req.param("employeeId")))).returning();
  if (!item) throw notFound("Payslip");
  if ("lopOverride" in b) await calculateRun(db, tid(c), run.id, uid(c));
  else await refreshTotals(db, run.id);
  await audit(c, { action: "payroll.item_update", entity: "payroll_item", entityId: item.id, summary: `${"onHold" in b ? (b.onHold ? "Held" : "Released") + " salary" : "Changed LOP"} for ${item.snapshot.name} (${run.month})`, data: b });
  return c.json({ ok: true });
});

payrollRoutes.post("/runs/:id/adjustments", requirePerm("payroll", "edit"), v("json", payrollAdjustmentSchema), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status === "approved" || run.status === "paid") throw badRequest("This payroll is locked");
  const b = c.req.valid("json");
  const db = c.get("db");
  const [e] = await db.select({ name: employees.fullName }).from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  const [row] = await db.insert(payrollAdjustments).values({ ...b, tenantId: tid(c), runId: run.id, createdBy: uid(c) }).returning();
  if (run.status === "calculated") await calculateRun(db, tid(c), run.id, uid(c));
  await audit(c, { action: "payroll.adjustment", entity: "payroll_adjustment", entityId: row!.id, summary: `Added ${b.kind} "${b.label}" ${inr(b.amount)} for ${e.name} (${run.month})` });
  return c.json(row, 201);
});

payrollRoutes.delete("/runs/:id/adjustments/:adjId", requirePerm("payroll", "edit"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status === "approved" || run.status === "paid") throw badRequest("This payroll is locked");
  const db = c.get("db");
  const [row] = await db.delete(payrollAdjustments).where(and(eq(payrollAdjustments.id, c.req.param("adjId")), eq(payrollAdjustments.runId, run.id))).returning();
  if (!row) throw notFound("Adjustment");
  if (run.status === "calculated") await calculateRun(db, tid(c), run.id, uid(c));
  await audit(c, { action: "payroll.adjustment_delete", entity: "payroll_adjustment", entityId: row.id, summary: `Removed "${row.label}" (${run.month})` });
  return c.json({ ok: true });
});

/** Approve & lock. Maker-checker: the person who calculated can't approve, unless they're a super admin. */
payrollRoutes.post("/runs/:id/approve", requirePerm("payroll", "approve"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "calculated") throw badRequest(run.status === "draft" ? "Calculate the payroll first" : "This payroll is already locked");
  const t = c.get("tenant");
  const db = c.get("db");
  if (run.calculatedBy === uid(c)) {
    const isSuper = can(t.permissions, "users", "configure") && can(t.permissions, "payroll", "configure");
    if (!isSuper) throw forbidden("Someone other than the person who calculated this payroll must approve it");
  }
  const [corr] = await db.select({ n: sql<number>`count(*)::int` }).from(attendanceCorrections).where(and(eq(attendanceCorrections.tenantId, t.tenantId), eq(attendanceCorrections.status, "pending"), gte(attendanceCorrections.date, run.periodStart), lte(attendanceCorrections.date, run.periodEnd)));
  if ((corr?.n ?? 0) > 0) throw badRequest(`Resolve ${corr!.n} pending attendance correction(s) for this month first, then recalculate`);
  const [updated] = await db.update(payrollRuns).set({ status: "approved", approvedBy: uid(c), approvedAt: new Date() }).where(and(eq(payrollRuns.id, run.id), eq(payrollRuns.status, "calculated"))).returning();
  if (!updated) throw badRequest("This payroll changed. Reload and try again.");
  await audit(c, { action: "payroll.approve", entity: "payroll_run", entityId: run.id, summary: `Approved and locked ${run.month} payroll (net ${inr(run.totals?.net ?? 0)})` });
  return c.json(updated);
});

payrollRoutes.post("/runs/:id/reopen", requirePerm("payroll", "configure"), v("json", reopenSchema), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved") throw badRequest(run.status === "paid" ? "This payroll is paid. Correct it with arrears or recoveries next month." : "Only a locked, unpaid payroll can be reopened");
  if (run.bankFileExportedAt) throw badRequest("The bank file was already exported. Cancel the bank upload before reopening, then try again.");
  const [later] = await c.get("db").select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), sql`${payrollRuns.month} > ${run.month}`)).limit(1);
  if (later) throw badRequest(`Payroll for ${later.month} already exists. Discard it first.`);
  const [row] = await c.get("db").update(payrollRuns).set({ status: "calculated", approvedBy: null, approvedAt: null, publishedAt: null }).where(eq(payrollRuns.id, run.id)).returning();
  await audit(c, { action: "payroll.reopen", entity: "payroll_run", entityId: run.id, summary: `Reopened ${run.month} payroll`, data: c.req.valid("json") });
  return c.json(row);
});

/** Publish payslips to self-service and email employees. */
payrollRoutes.post("/runs/:id/publish", requirePerm("payroll", "approve"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved" && run.status !== "paid") throw badRequest("Approve and lock the payroll first");
  const db = c.get("db");
  await db.update(payrollRuns).set({ publishedAt: new Date() }).where(eq(payrollRuns.id, run.id));
  const items = await db
    .select({ email: employees.workEmail, first: employees.firstName, net: payrollItems.net, onHold: payrollItems.onHold })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, run.id));
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  const monthName = new Date(run.month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  let sent = 0;
  const mailer = c.get("mailer");
  const queue = items.filter((i) => !i.onHold);
  // Send in small parallel batches to stay well inside Worker subrequest limits.
  for (let i = 0; i < queue.length; i += 10) {
    await Promise.all(
      queue.slice(i, i + 10).map(async (it) => {
        const { html, text } = layout({
          company: t?.name ?? "Strats360 People",
          heading: `Your payslip for ${monthName} is ready`,
          paragraphs: [`Hi ${it.first},`, `Your payslip for ${monthName} is now available in self-service.`, "For your security the payslip isn't attached to this email."],
          cta: { label: "View payslip", url: `${c.env.APP_URL}/me/payslips` },
        });
        try {
          await mailer.send({ to: it.email, subject: `Payslip for ${monthName}`, html, text });
          sent++;
        } catch (e) {
          console.error("payslip email failed", e);
        }
      }),
    );
  }
  await audit(c, { action: "payroll.publish", entity: "payroll_run", entityId: run.id, summary: `Published ${run.month} payslips (${sent} emailed)` });
  return c.json({ published: true, emailed: sent, held: items.length - queue.length });
});

/** Generic bank upload CSV. Excludes held salaries, zero/negative net and missing bank details. */
payrollRoutes.get("/runs/:id/bank-file.csv", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved" && run.status !== "paid") throw badRequest("Approve and lock the payroll first");
  const db = c.get("db");
  const rows = await db
    .select({ item: payrollItems, enc: employees.accountNumberEnc, holder: employees.accountHolderName, ifsc: employees.ifsc, email: employees.workEmail })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, run.id))
    .orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  const out: unknown[][] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of rows) {
    const acct = await decryptField(r.enc, c.env.ENCRYPTION_KEY);
    const amount = Number(r.item.net);
    if (r.item.onHold || amount <= 0 || !acct || !r.ifsc) {
      skipped++;
      continue;
    }
    const key = `${acct}|${amount}`;
    if (seen.has(key)) throw badRequest(`Duplicate payment detected for account ending ${acct.slice(-4)}. Check bank details before exporting.`);
    seen.add(key);
    out.push([r.item.snapshot.code, r.holder ?? r.item.snapshot.name, acct, r.ifsc, amount.toFixed(2), `SALARY ${run.month}`, r.email]);
  }
  await db.update(payrollRuns).set({ bankFileExportedAt: new Date() }).where(eq(payrollRuns.id, run.id));
  await audit(c, { action: "payroll.bank_file", entity: "payroll_run", entityId: run.id, summary: `Exported bank file for ${run.month}: ${out.length} payments, ${skipped} skipped` });
  const csv = toCsv(["Employee ID", "Beneficiary name", "Account number", "IFSC", "Amount", "Narration", "Email"], out);
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="salary-${run.month}-bank.csv"` });
});

payrollRoutes.get("/runs/:id/register.csv", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const items = await c.get("db").select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  const earnCodes = [...new Map(items.flatMap((i) => i.earnings.map((e) => [e.label, e.label]))).keys()];
  const dedCodes = [...new Map(items.flatMap((i) => i.deductions.map((e) => [e.label, e.label]))).keys()];
  const erCodes = [...new Map(items.flatMap((i) => i.employer.map((e) => [e.label, e.label]))).keys()];
  const amt = (lines: { label: string; amount: number }[], l: string) => lines.find((x) => x.label === l)?.amount ?? 0;
  const csv = toCsv(
    ["Employee ID", "Name", "Department", "Designation", "PAN", "UAN", "Days", "Paid days", "LOP", ...earnCodes, "Gross", ...dedCodes, "Total deductions", "Net pay", ...erCodes, "Employer cost", "CTC", "On hold"],
    items.map((i) => [
      i.snapshot.code, i.snapshot.name, i.snapshot.department, i.snapshot.designation, i.snapshot.pan, i.snapshot.uan, i.daysInMonth, i.paidDays, i.lopOverride ?? i.lopDays,
      ...earnCodes.map((l) => amt(i.earnings, l)), i.gross, ...dedCodes.map((l) => amt(i.deductions, l)), i.totalDeductions, i.net, ...erCodes.map((l) => amt(i.employer, l)), i.employerCost, Number(i.gross) + Number(i.employerCost), i.onHold ? "Yes" : "",
    ]),
  );
  await audit(c, { action: "payroll.register_export", entity: "payroll_run", entityId: run.id, summary: `Exported salary register for ${run.month}` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="salary-register-${run.month}.csv"` });
});

payrollRoutes.post("/runs/:id/mark-paid", requirePerm("payroll", "approve"), v("json", markPaidSchema), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved") throw badRequest(run.status === "paid" ? "Already marked as paid" : "Approve and lock the payroll first");
  if (!run.bankFileExportedAt) throw badRequest("Export the bank file before marking the payroll as paid");
  const b = c.req.valid("json");
  const [row] = await c
    .get("db")
    .update(payrollRuns)
    .set({ status: "paid", paidAt: new Date(b.paidOn + "T12:00:00+05:30"), paidBy: uid(c), paymentReference: b.reference ?? null, publishedAt: run.publishedAt ?? new Date() })
    .where(eq(payrollRuns.id, run.id))
    .returning();
  await audit(c, { action: "payroll.paid", entity: "payroll_run", entityId: run.id, summary: `Marked ${run.month} payroll as paid${b.reference ? ` (ref ${b.reference})` : ""}` });
  return c.json(row);
});

// ---------------------------------------------------------------------------
// Payslip view (shared with self-service)
// ---------------------------------------------------------------------------
export async function payslipView(c: Context<AppEnv>, run: typeof payrollRuns.$inferSelect, item: typeof payrollItems.$inferSelect) {
  const [t] = await c.get("db").select().from(tenants).where(eq(tenants.id, run.tenantId));
  return {
    company: { name: t?.name, legalName: t?.legalName, address: t?.registeredAddress, pan: t?.pan, tan: t?.tan, gstin: t?.gstin },
    run: { id: run.id, month: run.month, periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate, status: run.status },
    employee: { id: item.employeeId, ...item.snapshot },
    daysInMonth: item.daysInMonth,
    paidDays: item.paidDays,
    lopDays: item.lopOverride ?? item.lopDays,
    earnings: item.earnings,
    deductions: item.deductions,
    employer: item.employer,
    gross: item.gross,
    totalDeductions: item.totalDeductions,
    net: item.net,
    employerCost: item.employerCost,
    tax: item.tax,
    onHold: item.onHold,
    warnings: item.warnings,
  };
}

