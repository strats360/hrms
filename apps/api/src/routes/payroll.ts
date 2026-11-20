import { emitEvent, runEventData } from "../services/webhooks";
import { Hono, type Context } from "hono";
import { closeRepaidLoans } from "../services/loans";
import { allowedRecipients } from "../services/notifications";
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import {
  attendanceCorrections,
  employees,
  leaveRequests,
  payrollAdjustments,
  payrollItems,
  payrollRuns,
  salaryStructures,
  tenants,
  branches,
  employeeIdentities,
  user,
} from "@hrms/db";
import { offCycleRunSchema, isPeriodStart, nextPeriod, periodContaining, periodLabel, type PayFrequency, type PayPeriod, taxMonthOf, taxYearOf, buildMudadSheet, buildQatarWps, buildWpsSif, checkMudad, checkQatarWps, checkWps, can, decryptField, markPaidSchema, payrollAdjustmentSchema, payrollItemPatchSchema, payrollRunCreateSchema, reopenSchema, structureFromComponents, templateFor, minimumWageShortfall, structureFromCtc, structureRevisionSchema, tenantPayrollSettingsSchema, todayLocal, fmtDate, fmtMoney, zonedDateTime } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { layout } from "../lib/email";
import { settleClaims } from "../services/reimbursements";
import { rulesFor } from "../services/statutory";
import { releaseEncashment } from "../services/pay-extras";
import { activeBatchForRun } from "../services/payments";
import { entityOf, listEntities } from "../services/entities";
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
  checkExtras(salaryTemplate.extras);
  await db.update(tenants).set({ settings: { ...(t?.settings ?? {}), salaryTemplate } }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "payroll.template", entity: "tenant", entityId: tid(c), summary: "Updated salary template", data: salaryTemplate });
  return c.json(salaryTemplate);
});

// ---- named templates (grades, field staff, interns...) ----
const namedTemplateSchema = templateSchema.extend({ name: z.string().trim().min(2, "Name the template").max(60) });
type Named = z.infer<typeof namedTemplateSchema> & { id: string };

function checkExtras(extras?: { code: string }[]) {
  const codes = (extras ?? []).map((x) => x.code);
  const reserved = ["basic", "hra", "conveyance", "medical", "special"];
  const bad = codes.find((c, i) => codes.indexOf(c) !== i || reserved.includes(c));
  if (bad) throw badRequest(`Allowance code "${bad}" is used twice or is a built-in component`);
}

async function namedTemplates(c: Context<AppEnv>) {
  const [t] = await c.get("db").select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tid(c)));
  return { settings: (t?.settings ?? {}) as Record<string, unknown>, list: (((t?.settings ?? {}) as { salaryTemplates?: Named[] }).salaryTemplates ?? []) as Named[] };
}
async function saveTemplates(c: Context<AppEnv>, settings: Record<string, unknown>, list: Named[]) {
  await c.get("db").update(tenants).set({ settings: { ...settings, salaryTemplates: list } as typeof tenants.$inferInsert.settings }).where(eq(tenants.id, tid(c)));
}

payrollRoutes.get("/templates", requirePerm("payroll", "view"), async (c) => {
  const book = await getTemplate(c.get("db"), tid(c));
  const counts = await c
    .get("db")
    .select({ id: employees.salaryTemplateId, n: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(eq(employees.tenantId, tid(c)), sql`${employees.status} not in ('exited','inactive')`))
    .groupBy(employees.salaryTemplateId);
  const known = new Set((book.templates ?? []).map((x) => x.id));
  const count = (id: string | null) => counts.filter((r) => (id === null ? r.id === null || !known.has(r.id) : r.id === id)).reduce((a, r) => a + r.n, 0);
  const { templates, ...base } = book;
  return c.json([{ ...base, id: null, name: "Standard", isDefault: true, employees: count(null) }, ...(templates ?? []).map((x) => ({ ...x, isDefault: false, employees: count(x.id) }))]);
});

payrollRoutes.post("/templates", requirePerm("payroll", "configure"), v("json", namedTemplateSchema), async (c) => {
  const b = c.req.valid("json");
  checkExtras(b.extras);
  const { settings, list } = await namedTemplates(c);
  if (list.length >= 30) throw badRequest("Up to 30 templates");
  if (list.some((x) => x.name.toLowerCase() === b.name.toLowerCase()) || b.name.toLowerCase() === "standard") throw conflict(`A template called "${b.name}" already exists`);
  const row: Named = { ...b, id: crypto.randomUUID().slice(0, 8) };
  await saveTemplates(c, settings, [...list, row]);
  await audit(c, { action: "payroll.template_add", entity: "tenant", entityId: tid(c), summary: `Added salary template "${b.name}"`, data: row });
  return c.json(row, 201);
});

payrollRoutes.put("/templates/:tplId", requirePerm("payroll", "configure"), v("json", namedTemplateSchema), async (c) => {
  const b = c.req.valid("json");
  checkExtras(b.extras);
  const { settings, list } = await namedTemplates(c);
  const id = c.req.param("tplId");
  if (!list.some((x) => x.id === id)) throw notFound("Template");
  if (list.some((x) => x.id !== id && x.name.toLowerCase() === b.name.toLowerCase())) throw conflict(`A template called "${b.name}" already exists`);
  await saveTemplates(c, settings, list.map((x) => (x.id === id ? { ...b, id } : x)));
  await audit(c, { action: "payroll.template", entity: "tenant", entityId: tid(c), summary: `Updated salary template "${b.name}"`, data: b });
  return c.json({ ...b, id });
});

payrollRoutes.delete("/templates/:tplId", requirePerm("payroll", "configure"), async (c) => {
  const { settings, list } = await namedTemplates(c);
  const id = c.req.param("tplId");
  const tpl = list.find((x) => x.id === id);
  if (!tpl) throw notFound("Template");
  const [used] = await c.get("db").select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.tenantId, tid(c)), eq(employees.salaryTemplateId, id), sql`${employees.status} not in ('exited','inactive')`));
  if (used?.n) throw badRequest(`${used.n} employee${used.n === 1 ? " is" : "s are"} on "${tpl.name}". Move them to another template first.`);
  await saveTemplates(c, settings, list.filter((x) => x.id !== id));
  await audit(c, { action: "payroll.template_delete", entity: "tenant", entityId: tid(c), summary: `Deleted salary template "${tpl.name}"` });
  return c.json({ ok: true });
});

/** Put employees on a template (null: the standard one). Takes effect from the next calculation. */
payrollRoutes.post("/templates/assign", requirePerm("payroll", "configure"), v("json", z.object({ templateId: z.string().nullable(), employeeIds: z.array(z.string()).min(1).max(5000) })), async (c) => {
  const b = c.req.valid("json");
  const { list } = await namedTemplates(c);
  const tpl = b.templateId ? list.find((x) => x.id === b.templateId) : null;
  if (b.templateId && !tpl) throw notFound("Template");
  const rows = await c.get("db").update(employees).set({ salaryTemplateId: b.templateId }).where(and(eq(employees.tenantId, tid(c)), inArray(employees.id, b.employeeIds))).returning({ id: employees.id });
  await audit(c, { action: "payroll.template_assign", entity: "employee", summary: `Moved ${rows.length} employee${rows.length === 1 ? "" : "s"} to the "${tpl?.name ?? "Standard"}" salary template` });
  return c.json({ updated: rows.length });
});

/** Preview a structure for a CTC (or custom components) with the saved or a draft template. */
payrollRoutes.post(
  "/template/preview",
  requirePerm("payroll", "view"),
  v("json", z.object({ annualCtc: z.number().min(0).max(1e9), template: templateSchema.optional(), templateId: z.string().nullable().optional(), pfApplicable: z.boolean().default(true), esiApplicable: z.boolean().default(true) })),
  async (c) => {
    const b = c.req.valid("json");
    const template = b.template ?? templateFor(await getTemplate(c.get("db"), tid(c)), b.templateId);
    return c.json(structureFromCtc(b.annualCtc, template, { pfApplicable: b.pfApplicable, esiApplicable: b.esiApplicable }));
  },
);

/** Current structure for every active employee. */
payrollRoutes.get("/structures", requirePerm("payroll", "view"), v("query", z.object({ q: z.string().optional() })), async (c) => {
  const db = c.get("db");
  const today = todayLocal();
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
        return { employeeId: e.id, name: e.fullName, code: e.employeeCode, department, designation, templateId: e.salaryTemplateId, templateName: (template.templates ?? []).find((x) => x.id === e.salaryTemplateId)?.name ?? "Standard", annualCtc: s.annualCtc, monthlyGross: s.gross, basic: s.components.basic, employerPf: s.employer.pf, esiApplicable: s.esiApplicable, effectiveFrom: row?.effectiveFrom ?? e.dateOfJoining, source: row?.components ? "custom" : "template" };
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
  const current = (await structuresAsOf(db, tid(c), [e.id], todayLocal())).get(e.id);
  return c.json({
    employee: { id: e.id, name: e.fullName, code: e.employeeCode, dateOfJoining: e.dateOfJoining, pfApplicable: e.pfApplicable, esiApplicable: e.esiApplicable, taxRegime: e.taxRegime, templateId: e.salaryTemplateId },
    template: templateFor(template, e.salaryTemplateId),
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
    .orderBy(desc(payrollRuns.month))
    .limit(1);
  const lockedLabel = locked ? new Date(locked.month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  if (locked) throw badRequest(`Payroll up to ${lockedLabel} is already locked. Use an effective date after it, and add arrears as a one-time earning.`);
  const template = await getTemplate(db, tid(c));
  const annualCtc = b.components ? structureFromComponents(b.components, templateFor(template, e.salaryTemplateId), e).annualCtc : b.annualCtc;
  const [row] = await db
    .insert(salaryStructures)
    .values({ tenantId: tid(c), employeeId: e.id, effectiveFrom: b.effectiveFrom, annualCtc, components: b.components ?? null, reason: b.reason ?? null, createdBy: uid(c) })
    .onConflictDoUpdate({ target: [salaryStructures.tenantId, salaryStructures.employeeId, salaryStructures.effectiveFrom], set: { annualCtc, components: b.components ?? null, reason: b.reason ?? null } })
    .returning();
  if (b.effectiveFrom <= todayLocal()) await db.update(employees).set({ annualCtc }).where(eq(employees.id, e.id));
  // warn (not block) when the new salary is under the state's minimum wage
  const [br] = e.branchId ? await db.select({ state: branches.state }).from(branches).where(eq(branches.id, e.branchId)) : [];
  const [tn] = await db.select({ state: tenants.state, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tid(c)));
  const state = br?.state ?? tn?.state ?? null;
  const st = resolveStructure(e, { annualCtc, components: b.components ?? null }, template);
  const mw = state ? minimumWageShortfall((await rulesFor(db, b.effectiveFrom.slice(0, 7))).minWage[state], { basic: st.components.basic, gross: st.gross }, { category: e.wageCategory, basis: (tn?.settings as { minWageBasis?: "basic" | "gross" } | null)?.minWageBasis }) : null;
  const warning = mw ? `This is below the ${state} minimum wage${mw.label ? ` for ${mw.label.toLowerCase()} work` : ""}: monthly ${mw.basis} ${fmtMoney(mw.paid)} against ${fmtMoney(mw.required)}.` : null;
  await audit(c, { action: "payroll.structure", entity: "salary_structure", entityId: row!.id, summary: `Set ${e.fullName}'s CTC to ${fmtMoney(annualCtc)} from ${fmtDate(b.effectiveFrom)}${warning ? " (below minimum wage)" : ""}`, data: { reason: b.reason } });
  return c.json({ ...row, warning }, 201);
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
  const db = c.get("db");
  const [rows, entities] = await Promise.all([db.select().from(payrollRuns).where(eq(payrollRuns.tenantId, tid(c))).orderBy(desc(payrollRuns.month)), listEntities(db, tid(c))]);
  const ent = new Map(entities.map((e) => [e.id, e]));
  const n = await names(c, rows.flatMap((r) => [r.calculatedBy, r.approvedBy, r.paidBy]));
  return c.json(
    rows.map((r) => ({
      ...r,
      entityName: ent.get(r.entityId)?.name ?? null,
      entityCode: ent.get(r.entityId)?.code ?? null,
      country: ent.get(r.entityId)?.country ?? null,
      currency: ent.get(r.entityId)?.currency ?? null,
      calculatedByName: n.get(r.calculatedBy ?? "") ?? null,
      approvedByName: n.get(r.approvedBy ?? "") ?? null,
      paidByName: n.get(r.paidBy ?? "") ?? null,
    })),
  );
});

payrollRoutes.post("/runs", requirePerm("payroll", "edit"), v("json", payrollRunCreateSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  // each legal entity runs its own payroll; without one, the default entity
  const entities = await listEntities(db, tid(c));
  const ent = b.entityId ? entities.find((e) => e.id === b.entityId) : entities.find((e) => e.isDefault);
  if (!ent) throw badRequest("Pick one of your legal entities");
  const label = entities.length > 1 ? ` for ${ent.name}` : "";
  const scope = and(eq(payrollRuns.tenantId, tid(c)), eq(payrollRuns.entityId, ent.id), eq(payrollRuns.kind, "regular"));
  const frequency = (ent.payFrequency ?? "monthly") as PayFrequency;

  // the pay period: a month, or the entity's next (or given) shorter period
  let period: PayPeriod;
  if (frequency === "monthly") {
    if (!b.month) throw badRequest("Give the payroll month");
    period = periodContaining("monthly", `${b.month}-01`);
  } else {
    const anchor = ent.payAnchor;
    if (b.periodStart) {
      if (!isPeriodStart(frequency, b.periodStart, anchor)) throw badRequest(`${fmtDate(b.periodStart)} isn't the first day of a pay period on this entity's calendar`);
      period = periodContaining(frequency, b.periodStart, anchor);
    } else {
      // an open run is the one to carry on with
      const [openRun] = await db.select().from(payrollRuns).where(and(scope, inArray(payrollRuns.status, ["draft", "calculated"]))).orderBy(asc(payrollRuns.periodStart)).limit(1);
      if (openRun) return c.json(openRun, 200);
      const [last] = await db.select().from(payrollRuns).where(scope).orderBy(desc(payrollRuns.periodStart)).limit(1);
      period = last ? nextPeriod(periodContaining(frequency, last.periodStart, anchor), anchor) : periodContaining(frequency, todayLocal(), anchor);
    }
  }
  const name = periodLabel({ frequency, periodStart: period.start, periodEnd: period.end, month: period.month });
  const [exists] = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(scope, eq(payrollRuns.periodStart, period.start)));
  if (exists) throw conflict(`A payroll run${label} for ${name} already exists`);
  const [open] = await db.select({ month: payrollRuns.month, frequency: payrollRuns.frequency, periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd }).from(payrollRuns).where(and(scope, inArray(payrollRuns.status, ["draft", "calculated"]), lt(payrollRuns.periodStart, period.start)));
  if (open) throw badRequest(`Finish the ${periodLabel(open)} payroll${label} first (approve and lock it)`);
  const [run] = await db
    .insert(payrollRuns)
    .values({ tenantId: tid(c), entityId: ent.id, month: period.month, frequency, periodStart: period.start, periodEnd: period.end, payDate: b.payDate ?? (frequency === "monthly" ? defaultPayDate(period.month) : period.payDate), preparedBy: uid(c) })
    .returning();
  await audit(c, { action: "payroll.run_create", entity: "payroll_run", entityId: run!.id, summary: `Started payroll${label} for ${name}` });
  return c.json(run, 201);
});

/**
 * An off-cycle run: one-off payments (a bonus, arrears, an incentive) paid outside the regular
 * payroll, for Indian entities. It's calculated straight away and then goes through the same
 * review, approval, payslips and bank file as any run.
 */
payrollRoutes.post("/runs/off-cycle", requirePerm("payroll", "edit"), v("json", offCycleRunSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const entities = await listEntities(db, tid(c));
  const ent = b.entityId ? entities.find((e) => e.id === b.entityId) : entities.find((e) => e.isDefault);
  if (!ent) throw badRequest("Pick one of your legal entities");
  if (ent.country !== "IN") throw badRequest("Off-cycle runs are for Indian entities for now");
  const ids = [...new Set(b.lines.map((l) => l.employeeId))];
  const found = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid(c)), inArray(employees.id, ids)));
  if (found.length !== ids.length) throw badRequest("Some of those employees aren't in this company");
  const [run] = await db
    .insert(payrollRuns)
    .values({ tenantId: tid(c), entityId: ent.id, kind: "off_cycle", label: b.label, month: b.payDate.slice(0, 7), frequency: ent.payFrequency ?? "monthly", periodStart: b.payDate, periodEnd: b.payDate, payDate: b.payDate, preparedBy: uid(c) })
    .returning();
  await db.insert(payrollAdjustments).values(b.lines.map((l) => ({ tenantId: tid(c), runId: run!.id, employeeId: l.employeeId, kind: "earning" as const, label: l.label || b.label, amount: l.amount, taxable: l.taxable, esiWage: false, source: "off_cycle", createdBy: uid(c) })));
  await calculateRun(db, tid(c), run!.id, uid(c));
  await audit(c, { action: "payroll.off_cycle", entity: "payroll_run", entityId: run!.id, summary: `Started an off-cycle run, ${b.label}, for ${ids.length} employee${ids.length === 1 ? "" : "s"}` });
  return c.json(await loadRun(c, run!.id), 201);
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
  const [prev] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), eq(payrollRuns.entityId, run.entityId), eq(payrollRuns.kind, "regular"), lt(payrollRuns.periodStart, run.periodStart))).orderBy(desc(payrollRuns.periodStart)).limit(1);
  const ent = await entityOf(db, tid(c), run.entityId);
  return c.json({
    ...run,
    entityName: ent.name,
    entityCode: ent.code,
    country: ent.country,
    currency: ent.currency,
    preparedByName: n.get(run.preparedBy ?? "") ?? null,
    calculatedByName: n.get(run.calculatedBy ?? "") ?? null,
    approvedByName: n.get(run.approvedBy ?? "") ?? null,
    paidByName: n.get(run.paidBy ?? "") ?? null,
    previous: prev ? { id: prev.id, month: prev.month, status: prev.status, totals: prev.totals, approvedAt: prev.approvedAt } : null,
    paymentBatch: await activeBatchForRun(db, run.id).then((b) => (b ? { id: b.id, code: b.code, status: b.status } : null)),
  });
});

/** Step 2 + 3 checks: who's in, joiners, exits, revisions, missing data and blockers. */
payrollRoutes.get("/runs/:id/inputs", requirePerm("payroll", "view"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const db = c.get("db");
  const emps = await payableEmployees(db, tid(c), run.periodStart, run.periodEnd, await entityOf(db, tid(c), run.entityId));
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
  const prevRun = (await c.get("db").select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), eq(payrollRuns.entityId, run.entityId), eq(payrollRuns.kind, "regular"), lt(payrollRuns.periodStart, run.periodStart))).orderBy(desc(payrollRuns.periodStart)).limit(1))[0];
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
  await audit(c, { action: "payroll.adjustment", entity: "payroll_adjustment", entityId: row!.id, summary: `Added ${b.kind} "${b.label}" ${fmtMoney(b.amount)} for ${e.name} (${run.month})` });
  return c.json(row, 201);
});

payrollRoutes.delete("/runs/:id/adjustments/:adjId", requirePerm("payroll", "edit"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status === "approved" || run.status === "paid") throw badRequest("This payroll is locked");
  const db = c.get("db");
  const [loanLine] = await db.select({ source: payrollAdjustments.source }).from(payrollAdjustments).where(and(eq(payrollAdjustments.id, c.req.param("adjId")), eq(payrollAdjustments.runId, run.id)));
  if (loanLine?.source === "loan") throw badRequest("Loan recoveries come from the loan. To skip this month, pause it under Payroll › Loans and recalculate.");
  const [row] = await db.delete(payrollAdjustments).where(and(eq(payrollAdjustments.id, c.req.param("adjId")), eq(payrollAdjustments.runId, run.id))).returning();
  if (!row) throw notFound("Adjustment");
  await releaseEncashment(db, row);
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
  await emitEvent(c, "payroll.approved", runEventData(run));
  await audit(c, { action: "payroll.approve", entity: "payroll_run", entityId: run.id, summary: `Approved and locked ${run.month} payroll (net ${fmtMoney(run.totals?.net ?? 0)})` });
  await closeRepaidLoans(db, tid(c));
  return c.json(updated);
});

payrollRoutes.post("/runs/:id/reopen", requirePerm("payroll", "configure"), v("json", reopenSchema), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved") throw badRequest(run.status === "paid" ? "This payroll is paid. Correct it with arrears or recoveries next month." : "Only a locked, unpaid payroll can be reopened");
  if (run.bankFileExportedAt) throw badRequest("The bank file was already exported. Cancel the bank upload before reopening, then try again.");
  const batch = await activeBatchForRun(c.get("db"), run.id);
  if (batch) throw badRequest(`Payment batch ${batch.code} pays this payroll. Cancel it in Payments first.`);
  const [later] = await c.get("db").select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), eq(payrollRuns.entityId, run.entityId), eq(payrollRuns.kind, "regular"), gt(payrollRuns.periodStart, run.periodStart))).limit(1);
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
  const wanted = items.filter((i) => !i.onHold);
  // the company or the employee may have turned these emails off
  const allowed = await allowedRecipients(db, tid(c), "payslip_published", wanted.map((i) => i.email));
  const queue = wanted.filter((i) => allowed.has(i.email));
  // Send in small parallel batches to stay well inside Worker subrequest limits.
  for (let i = 0; i < queue.length; i += 10) {
    await Promise.all(
      queue.slice(i, i + 10).map(async (it) => {
        const { html, text } = layout({
          company: t?.name ?? "Saralix",
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
  return c.json({ published: true, emailed: sent, held: items.length - wanted.length, emailsOff: wanted.length - queue.length });
});

/** Generic bank upload CSV. Excludes held salaries, zero/negative net and missing bank details. */
payrollRoutes.get("/runs/:id/bank-file.csv", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved" && run.status !== "paid") throw badRequest("Approve and lock the payroll first");
  const db = c.get("db");
  const batch = await activeBatchForRun(db, run.id);
  if (batch) throw badRequest(`Payment batch ${batch.code} pays this payroll. Download the bank file from Payments.`);
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

/**
 * UAE Wage Protection System salary file (SIF) for a run of a UAE entity. It pays the same people
 * as the bank file: held salaries and zero net pay are left out.
 */
payrollRoutes.get("/runs/:id/wps.sif", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved" && run.status !== "paid") throw badRequest("Approve and lock the payroll first");
  const db = c.get("db");
  const ent = await entityOf(db, tid(c), run.entityId);
  if (ent.country !== "AE") throw badRequest("The WPS file is for UAE entities only");
  const rows = await db
    .select({ item: payrollItems, enc: employees.accountNumberEnc, routing: employees.ifsc })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, run.id))
    .orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  const ids = rows.map((r) => r.item.employeeId);
  const personIds = new Map(
    ids.length
      ? (await db.select({ e: employeeIdentities.employeeId, n: employeeIdentities.number }).from(employeeIdentities).where(and(eq(employeeIdentities.tenantId, tid(c)), eq(employeeIdentities.type, "mohre_person_id"), inArray(employeeIdentities.employeeId, ids)))).map((r) => [r.e, r.n.replace(/\s/g, "")])
      : [],
  );
  const reg = (ent.registrations ?? {}) as Record<string, string | null>;
  const people = [];
  for (const r of rows) {
    const net = Number(r.item.net);
    if (r.item.onHold || net <= 0) continue;
    // one-off earnings (overtime, bonus) are variable pay; the rest of the net is fixed
    const variable = Math.min(net, r.item.earnings.filter((l) => l.code.startsWith("adj_e")).reduce((sum, l) => sum + l.amount, 0));
    people.push({
      name: r.item.snapshot.name,
      personId: personIds.get(r.item.employeeId) ?? "",
      routingCode: r.routing ?? "",
      iban: (await decryptField(r.enc, c.env.ENCRYPTION_KEY)) ?? "",
      payStart: run.periodStart,
      payEnd: run.periodEnd,
      daysInPeriod: r.item.daysInMonth,
      fixed: Math.round((net - variable) * 100) / 100,
      variable,
      leaveDays: Number(r.item.lopOverride ?? r.item.lopDays),
    });
  }
  const file = { employerId: reg.mohreId ?? "", employerRoutingCode: reg.wpsRoutingCode ?? "", month: run.month, createdAt: new Date(), employees: people, reference: `SALARY ${run.month}` };
  const errors = checkWps(file);
  if (errors.length) throw badRequest(errors.length === 1 ? errors[0]! : `${errors.length} things need fixing before the WPS file can go: ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? " ..." : ""}`);
  const sif = buildWpsSif(file);
  await audit(c, { action: "payroll.wps_file", entity: "payroll_run", entityId: run.id, summary: `Exported the WPS file for ${run.month}: ${people.length} payments` });
  return c.body(sif.content, 200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${sif.fileName}"` });
});

/**
 * Saudi wage protection: the salary sheet for Mudad and the bank, for a run of a Saudi entity.
 * Same people as the bank file: held salaries and zero net pay are left out.
 */
payrollRoutes.get("/runs/:id/mudad.csv", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved" && run.status !== "paid") throw badRequest("Approve and lock the payroll first");
  const db = c.get("db");
  const ent = await entityOf(db, tid(c), run.entityId);
  if (ent.country !== "SA") throw badRequest("The Mudad sheet is for Saudi entities only");
  const rows = await db
    .select({ item: payrollItems, enc: employees.accountNumberEnc })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, run.id))
    .orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  const ids = rows.map((r) => r.item.employeeId);
  // Saudis are paid against their national ID, everyone else against their iqama
  const idRows = ids.length
    ? await db.select({ e: employeeIdentities.employeeId, type: employeeIdentities.type, n: employeeIdentities.number }).from(employeeIdentities).where(and(eq(employeeIdentities.tenantId, tid(c)), inArray(employeeIdentities.type, ["saudi_id", "iqama"]), inArray(employeeIdentities.employeeId, ids)))
    : [];
  const idOf = new Map<string, string>();
  for (const r of idRows) if (!idOf.has(r.e) || r.type === "saudi_id") idOf.set(r.e, r.n.replace(/\s/g, ""));
  const people = [];
  for (const r of rows) {
    const net = Number(r.item.net);
    if (r.item.onHold || net <= 0) continue;
    const line = (code: string) => r.item.earnings.find((l) => l.code === code)?.amount ?? 0;
    const basic = line("basic");
    const housing = line("hra");
    people.push({
      name: r.item.snapshot.name,
      idNumber: idOf.get(r.item.employeeId) ?? "",
      iban: (await decryptField(r.enc, c.env.ENCRYPTION_KEY)) ?? "",
      basic,
      housing,
      otherEarnings: Math.round((Number(r.item.gross) - basic - housing + Number(r.item.reimbursement ?? 0)) * 100) / 100,
      deductions: Number(r.item.totalDeductions),
      net,
    });
  }
  const reg = (ent.registrations ?? {}) as Record<string, string | null>;
  const sheet = { establishmentId: reg.mhrsdId ?? "", month: run.month, employees: people };
  const errors = checkMudad(sheet);
  if (errors.length) throw badRequest(errors.length === 1 ? errors[0]! : `${errors.length} things need fixing before the Mudad sheet can go: ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? " ..." : ""}`);
  const file = buildMudadSheet(sheet);
  await audit(c, { action: "payroll.mudad_file", entity: "payroll_run", entityId: run.id, summary: `Exported the Mudad salary sheet for ${run.month}: ${people.length} payments` });
  return c.body(file.content, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"` });
});

/** Qatar Wage Protection System salary file for a run of a Qatar entity. Same people as the bank file. */
payrollRoutes.get("/runs/:id/qatar-wps.csv", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved" && run.status !== "paid") throw badRequest("Approve and lock the payroll first");
  const db = c.get("db");
  const ent = await entityOf(db, tid(c), run.entityId);
  if (ent.country !== "QA") throw badRequest("The Qatar WPS file is for Qatar entities only");
  const rows = await db
    .select({ item: payrollItems, enc: employees.accountNumberEnc, bank: employees.bankName })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, run.id))
    .orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  const ids = rows.map((r) => r.item.employeeId);
  const qids = new Map(
    ids.length
      ? (await db.select({ e: employeeIdentities.employeeId, n: employeeIdentities.number }).from(employeeIdentities).where(and(eq(employeeIdentities.tenantId, tid(c)), eq(employeeIdentities.type, "qid"), inArray(employeeIdentities.employeeId, ids)))).map((r) => [r.e, r.n.replace(/\s/g, "")])
      : [],
  );
  const people = [];
  for (const r of rows) {
    const net = Number(r.item.net);
    if (r.item.onHold || net <= 0) continue;
    const basic = r.item.earnings.find((l) => l.code === "basic")?.amount ?? 0;
    const extra = Math.round((Number(r.item.gross) - basic + Number(r.item.reimbursement ?? 0)) * 100) / 100;
    people.push({
      name: r.item.snapshot.name,
      qid: qids.get(r.item.employeeId) ?? "",
      bank: r.bank ?? "",
      iban: (await decryptField(r.enc, c.env.ENCRYPTION_KEY)) ?? "",
      workingDays: Number(r.item.paidDays),
      net,
      basic,
      extraHours: 0,
      extraIncome: extra,
      deductions: Number(r.item.totalDeductions),
    });
  }
  const reg = (ent.registrations ?? {}) as Record<string, string | null>;
  const file = { employerId: reg.establishmentId ?? "", payerBank: reg.payerBank ?? "", payerIban: reg.payerIban ?? "", month: run.month, createdAt: new Date(), employees: people };
  const errors = checkQatarWps(file);
  if (errors.length) throw badRequest(errors.length === 1 ? errors[0]! : `${errors.length} things need fixing before the WPS file can go: ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? " ..." : ""}`);
  const out = buildQatarWps(file);
  await audit(c, { action: "payroll.wps_file", entity: "payroll_run", entityId: run.id, summary: `Exported the Qatar WPS file for ${run.month}: ${people.length} payments` });
  return c.body(out.content, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.fileName}"` });
});

/**
 * UK: the figures an RTI Full Payment Submission needs for each employee, this month and for the
 * tax year to date. Saralix can't file to HMRC yet, so this goes into HMRC's Basic PAYE Tools or
 * your filing service.
 */
payrollRoutes.get("/runs/:id/rti.csv", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status === "draft") throw badRequest("Calculate the payroll first");
  const db = c.get("db");
  const ent = await entityOf(db, tid(c), run.entityId);
  if (ent.country !== "GB") throw badRequest("The RTI summary is for UK entities only");
  const items = await db.select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  const ids = items.map((i) => i.employeeId);
  // the tax year so far: locked runs of this entity from April up to this month, plus this one
  const taxYear = taxYearOf(run.month);
  const startMonth = `${taxYear.slice(0, 4)}-04`;
  const earlier = ids.length
    ? await db
        .select({ item: payrollItems })
        .from(payrollItems)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
        .where(and(eq(payrollRuns.tenantId, tid(c)), eq(payrollRuns.entityId, run.entityId), inArray(payrollRuns.status, ["approved", "paid"]), gte(payrollRuns.month, startMonth), lt(payrollRuns.periodStart, run.periodStart), inArray(payrollItems.employeeId, ids)))
    : [];
  const [emps, ninos] = ids.length
    ? await Promise.all([
        db.select({ id: employees.id, profile: employees.countryProfile }).from(employees).where(inArray(employees.id, ids)),
        db.select({ e: employeeIdentities.employeeId, n: employeeIdentities.number }).from(employeeIdentities).where(and(eq(employeeIdentities.tenantId, tid(c)), eq(employeeIdentities.type, "ni_number"), inArray(employeeIdentities.employeeId, ids))),
      ])
    : [[], []];
  const profile = new Map(emps.map((e) => [e.id, (e.profile ?? {}) as { taxCode?: string; niCategory?: string }]));
  const nino = new Map(ninos.map((r) => [r.e, r.n.replace(/\s/g, "").toUpperCase()]));
  type Item = typeof payrollItems.$inferSelect;
  const sum = (list: Item[], f: (i: Item) => number) => Math.round(list.reduce((s, i) => s + f(i), 0) * 100) / 100;
  const ded = (code: string) => (i: Item) => i.deductions.filter((d) => d.code === code || (code === "sl" && d.code.startsWith("sl_"))).reduce((s, d) => s + d.amount, 0);
  const er = (code: string) => (i: Item) => i.employer.filter((d) => d.code === code).reduce((s, d) => s + d.amount, 0);
  const taxable = (i: Item) => Number(i.taxableGross);
  const rows = items.map((i) => {
    const ytd = [...earlier.map((x) => x.item).filter((x) => x.employeeId === i.employeeId), i];
    const p = profile.get(i.employeeId) ?? {};
    return [
      i.snapshot.code,
      i.snapshot.name,
      nino.get(i.employeeId) ?? "",
      p.taxCode ?? "1257L",
      p.niCategory ?? "A",
      taxMonthOf(run.month),
      taxable(i).toFixed(2),
      sum(ytd, taxable).toFixed(2),
      ded("paye")(i).toFixed(2),
      sum(ytd, ded("paye")).toFixed(2),
      ded("ni")(i).toFixed(2),
      sum(ytd, ded("ni")).toFixed(2),
      er("ni_er")(i).toFixed(2),
      sum(ytd, er("ni_er")).toFixed(2),
      ded("sl")(i).toFixed(2),
      ded("pgl")(i).toFixed(2),
      ded("pension")(i).toFixed(2),
      er("pension_er")(i).toFixed(2),
      Number(i.net).toFixed(2),
    ];
  });
  const csv = toCsv(
    ["Employee ID", "Name", "NI number", "Tax code", "NI category", "Tax month", "Taxable pay", "Taxable pay to date", "Tax", "Tax to date", "Employee NI", "Employee NI to date", "Employer NI", "Employer NI to date", "Student loan", "Postgraduate loan", "Pension (employee)", "Pension (employer)", "Net pay"],
    rows,
  );
  await audit(c, { action: "payroll.rti_summary", entity: "payroll_run", entityId: run.id, summary: `Exported the RTI summary for ${run.month}` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rti-${taxYear}-month${taxMonthOf(run.month)}.csv"` });
});

payrollRoutes.get("/runs/:id/register.csv", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const items = await c.get("db").select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  const earnCodes = [...new Map(items.flatMap((i) => i.earnings.map((e) => [e.label, e.label]))).keys()];
  const dedCodes = [...new Map(items.flatMap((i) => i.deductions.map((e) => [e.label, e.label]))).keys()];
  const erCodes = [...new Map(items.flatMap((i) => i.employer.map((e) => [e.label, e.label]))).keys()];
  const amt = (lines: { label: string; amount: number }[], l: string) => lines.find((x) => x.label === l)?.amount ?? 0;
  const csv = toCsv(
    ["Employee ID", "Name", "Department", "Designation", "PAN", "UAN", "Days", "Paid days", "LOP", ...earnCodes, "Gross", ...dedCodes, "Total deductions", "Reimbursements", "Net pay", ...erCodes, "Employer cost", "CTC", "On hold"],
    items.map((i) => [
      i.snapshot.code, i.snapshot.name, i.snapshot.department, i.snapshot.designation, i.snapshot.pan, i.snapshot.uan, i.daysInMonth, i.paidDays, i.lopOverride ?? i.lopDays,
      ...earnCodes.map((l) => amt(i.earnings, l)), i.gross, ...dedCodes.map((l) => amt(i.deductions, l)), i.totalDeductions, i.reimbursement, i.net, ...erCodes.map((l) => amt(i.employer, l)), i.employerCost, Number(i.gross) + Number(i.employerCost), i.onHold ? "Yes" : "",
    ]),
  );
  await audit(c, { action: "payroll.register_export", entity: "payroll_run", entityId: run.id, summary: `Exported salary register for ${run.month}` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="salary-register-${run.month}.csv"` });
});

payrollRoutes.post("/runs/:id/mark-paid", requirePerm("payroll", "approve"), v("json", markPaidSchema), async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "approved") throw badRequest(run.status === "paid" ? "Already marked as paid" : "Approve and lock the payroll first");
  if (!run.bankFileExportedAt) throw badRequest("Export the bank file before marking the payroll as paid");
  const batch = await activeBatchForRun(c.get("db"), run.id);
  if (batch) throw badRequest(`Payment batch ${batch.code} pays this payroll. Record the bank's result in Payments and the payroll is marked paid automatically.`);
  const b = c.req.valid("json");
  const [row] = await c
    .get("db")
    .update(payrollRuns)
    .set({ status: "paid", paidAt: zonedDateTime(b.paidOn, "12:00"), paidBy: uid(c), paymentReference: b.reference ?? null, publishedAt: run.publishedAt ?? new Date() })
    .where(eq(payrollRuns.id, run.id))
    .returning();
  const held = (await c.get("db").select({ e: payrollItems.employeeId }).from(payrollItems).where(and(eq(payrollItems.runId, run.id), eq(payrollItems.onHold, true)))).map((r) => r.e);
  await settleClaims(c.get("db"), run.id, held);
  await emitEvent(c, "payroll.paid", runEventData(run));
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
    reimbursement: item.reimbursement,
    fbpCredit: item.fbpCredit ? Object.values(item.fbpCredit).reduce((s, n) => s + n, 0) : 0,
    net: item.net,
    employerCost: item.employerCost,
    tax: item.tax,
    onHold: item.onHold,
    warnings: item.warnings,
  };
}

