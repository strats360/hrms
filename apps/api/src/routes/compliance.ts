import { Hono, type Context } from "hono";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { attendanceRecords, employees, payrollItems, payrollRuns, statutoryChallans, tenants, type Database } from "@hrms/db";
import {
  challanSchema,
  daysUntil,
  dueDate,
  ecrLine,
  fmtDate,
  fyOfMonth,
  inr,
  LWF_RULES,
  NO_PT_STATES,
  pfWages,
  PT_RULES,
  ptSlabSummary,
  STATUTE_LABELS,
  STATUTORY,
  tdsReturnDueDates,
  todayIST,
  type Statute,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { ALLOWED_TYPES, getFile, MAX_UPLOAD_BYTES, putFile, safeName } from "../lib/storage";
import { getTemplate, monthBounds, resolveStructure, structuresAsOf } from "../services/payroll";
import { monthLabel } from "../lib/months";

export const complianceRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
export const LOCKED = ["approved", "paid"];

export type Item = typeof payrollItems.$inferSelect;
const line = (lines: { code: string; amount: number }[], ...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);

export interface Obligation {
  key: string;
  statute: Statute;
  label: string;
  period: string;
  jurisdiction: string;
  amount: number;
  breakup: { label: string; amount: number }[];
  employees: number;
  dueDate: string;
  daysLeft: number;
  status: "paid" | "overdue" | "due_soon" | "upcoming";
  challan: typeof statutoryChallans.$inferSelect | null;
}

/** Obligations for one locked run: EPF, ESI, TDS once; PT and LWF per state. */
export function obligationsForRun(run: { month: string }, items: Item[]) {
  const out: Omit<Obligation, "dueDate" | "daysLeft" | "status" | "challan" | "key" | "label">[] = [];
  const contributors = (f: (i: Item) => number) => items.filter((i) => f(i) > 0).length;

  const epfEe = items.reduce((s, i) => s + line(i.deductions, "pf"), 0);
  const epfEr = items.reduce((s, i) => s + line(i.employer, "epf_er"), 0);
  const eps = items.reduce((s, i) => s + line(i.employer, "eps"), 0);
  const edli = items.reduce((s, i) => s + line(i.employer, "edli"), 0);
  const admin = items.reduce((s, i) => s + line(i.employer, "pf_admin"), 0);
  if (epfEe + epfEr + eps > 0)
    out.push({
      statute: "epf",
      period: run.month,
      jurisdiction: "",
      amount: epfEe + epfEr + eps + edli + admin,
      breakup: [
        { label: "A/c 1 · EPF (employee + employer)", amount: epfEe + epfEr },
        { label: "A/c 2 · Admin charges", amount: admin },
        { label: "A/c 10 · Pension (EPS)", amount: eps },
        { label: "A/c 21 · EDLI", amount: edli },
      ],
      employees: contributors((i) => line(i.deductions, "pf")),
    });

  const esiEe = items.reduce((s, i) => s + line(i.deductions, "esi"), 0);
  const esiEr = items.reduce((s, i) => s + line(i.employer, "esi_er"), 0);
  if (esiEe + esiEr > 0)
    out.push({ statute: "esi", period: run.month, jurisdiction: "", amount: esiEe + esiEr, breakup: [{ label: "Employee 0.75%", amount: esiEe }, { label: "Employer 3.25%", amount: esiEr }], employees: contributors((i) => line(i.deductions, "esi")) });

  const tds = items.reduce((s, i) => s + Number(i.tds), 0);
  if (tds > 0) out.push({ statute: "tds", period: run.month, jurisdiction: "", amount: tds, breakup: [{ label: "Income tax deducted (192)", amount: tds }], employees: contributors((i) => Number(i.tds)) });

  const states = [...new Set(items.map((i) => i.snapshot.state ?? ""))];
  for (const st of states) {
    const inState = items.filter((i) => (i.snapshot.state ?? "") === st);
    const pt = inState.reduce((s, i) => s + line(i.deductions, "pt"), 0);
    if (pt > 0) out.push({ statute: "pt", period: run.month, jurisdiction: st, amount: pt, breakup: [{ label: `Professional Tax · ${st}`, amount: pt }], employees: inState.filter((i) => line(i.deductions, "pt") > 0).length });
    const lwfEe = inState.reduce((s, i) => s + line(i.deductions, "lwf"), 0);
    const lwfEr = inState.reduce((s, i) => s + line(i.employer, "lwf_er"), 0);
    if (lwfEe + lwfEr > 0) out.push({ statute: "lwf", period: run.month, jurisdiction: st, amount: lwfEe + lwfEr, breakup: [{ label: "Employee share", amount: lwfEe }, { label: "Employer share", amount: lwfEr }], employees: inState.filter((i) => line(i.deductions, "lwf") > 0).length });
  }
  return out;
}

async function loadObligations(db: Database, tenantId: string, filter: { from?: string; to?: string } = {}) {
  const conds = [eq(payrollRuns.tenantId, tenantId), inArray(payrollRuns.status, LOCKED)];
  if (filter.from) conds.push(gte(payrollRuns.month, filter.from));
  if (filter.to) conds.push(lte(payrollRuns.month, filter.to));
  const runs = await db.select().from(payrollRuns).where(and(...conds)).orderBy(desc(payrollRuns.month));
  if (!runs.length) return [];
  const items = await db.select().from(payrollItems).where(inArray(payrollItems.runId, runs.map((r) => r.id)));
  const challans = await db.select().from(statutoryChallans).where(eq(statutoryChallans.tenantId, tenantId));
  const today = todayIST();
  const out: Obligation[] = [];
  for (const run of runs) {
    for (const o of obligationsForRun(run, items.filter((i) => i.runId === run.id))) {
      const due = dueDate(o.statute, o.period, o.jurisdiction || null);
      const challan = challans.find((c) => c.statute === o.statute && c.period === o.period && c.jurisdiction === o.jurisdiction) ?? null;
      const left = daysUntil(due, today);
      out.push({
        ...o,
        key: `${o.statute}|${o.period}|${o.jurisdiction}`,
        label: STATUTE_LABELS[o.statute] + (o.jurisdiction && (o.statute === "pt" || o.statute === "lwf") ? ` · ${o.jurisdiction}` : ""),
        dueDate: due,
        daysLeft: left,
        status: challan ? "paid" : left < 0 ? "overdue" : left <= 7 ? "due_soon" : "upcoming",
        challan,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
complianceRoutes.get("/overview", requirePerm("compliance", "view"), async (c) => {
  const db = c.get("db");
  const today = todayIST();
  const obligations = await loadObligations(db, tid(c));
  const latestMonth = obligations[0]?.period ?? null;
  const latest = obligations.filter((o) => o.period === latestMonth);
  const open = obligations.filter((o) => o.status !== "paid").sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Filing calendar: unpaid obligations + this FY's 24Q / Form 16 deadlines still ahead
  const fy = fyOfMonth(today.slice(0, 7));
  const calendar = [
    ...open.map((o) => ({ date: o.dueDate, title: `${o.label} · ${monthLabel(o.period)}`, amount: o.amount, daysLeft: o.daysLeft, kind: "payment" as const })),
    ...tdsReturnDueDates(fy)
      .filter((q) => q.due >= today)
      .map((q) => ({ date: q.due, title: q.quarter === "Form 16" ? `Form 16 to employees · ${q.period}` : `TDS return 24Q ${q.quarter} · ${q.period}`, amount: null, daysLeft: daysUntil(q.due, today), kind: "return" as const })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);

  // Also tracked: gratuity, overtime, EDLI
  const tenantId = tid(c);
  const active = await db
    .select()
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), sql`${employees.status} in ('active','probation','notice')`));
  const years = (doj: string) => {
    const a = new Date(doj + "T00:00:00Z");
    const b = new Date(today + "T00:00:00Z");
    let y = b.getUTCFullYear() - a.getUTCFullYear();
    if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
    return y;
  };
  const template = await getTemplate(db, tenantId);
  const eligible = active.filter((e) => years(e.dateOfJoining) >= 5);
  const structs = await structuresAsOf(db, tenantId, eligible.map((e) => e.id), today);
  // Payment of Gratuity Act: 15/26 x last basic x completed years, capped at ₹20 lakh
  const gratuity = eligible.reduce((s, e) => s + Math.min(2000000, Math.round((15 / 26) * resolveStructure(e, structs.get(e.id), template).components.basic * years(e.dateOfJoining))), 0);

  let overtimeHours = 0;
  if (latestMonth) {
    const [ot] = await db
      .select({ m: sql<number>`coalesce(sum(${attendanceRecords.overtimeMinutes}),0)::int` })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.tenantId, tenantId), gte(attendanceRecords.date, monthBounds(latestMonth).start), lte(attendanceRecords.date, monthBounds(latestMonth).end)));
    overtimeHours = Math.round((ot?.m ?? 0) / 60);
  }
  const edliMembers = latest.find((o) => o.statute === "epf")?.employees ?? 0;

  return c.json({
    latestMonth,
    cards: latest,
    overdue: obligations.filter((o) => o.status === "overdue").length,
    dueSoon: obligations.filter((o) => o.status === "due_soon").length,
    calendar,
    tracked: { gratuityEligible: eligible.length, gratuityProvision: gratuity, overtimeHours, edliMembers },
  });
});

// ---------------------------------------------------------------------------
// Obligations and challans
// ---------------------------------------------------------------------------
complianceRoutes.get("/obligations", requirePerm("compliance", "view"), v("query", z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional(), statute: z.string().optional() })), async (c) => {
  const q = c.req.valid("query");
  const fy = q.fy ?? fyOfMonth(todayIST().slice(0, 7));
  const y = Number(fy.slice(0, 4));
  let rows = await loadObligations(c.get("db"), tid(c), { from: `${y}-04`, to: `${y + 1}-03` });
  if (q.statute) rows = rows.filter((r) => r.statute === q.statute);
  return c.json({ fy, rows });
});

complianceRoutes.post("/challans", requirePerm("compliance", "edit"), v("json", challanSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const obligation = (await loadObligations(db, tid(c), { from: b.period, to: b.period })).find((o) => o.statute === b.statute && o.jurisdiction === b.jurisdiction);
  if (!obligation) throw badRequest("There's no locked payroll liability for that statute and month");
  if (obligation.challan) throw badRequest("A payment is already recorded for this. Edit it instead.");
  if (b.paidOn > todayIST()) throw badRequest("The payment date can't be in the future");
  const [row] = await db
    .insert(statutoryChallans)
    .values({ ...b, tenantId: tid(c), amountDue: obligation.amount, createdBy: c.get("session")!.userId })
    .returning();
  const late = daysUntil(obligation.dueDate, b.paidOn) < 0;
  await audit(c, { action: "compliance.challan", entity: "statutory_challan", entityId: row!.id, summary: `Recorded ${obligation.label} payment for ${monthLabel(b.period)}: ${inr(b.amountPaid)}${late ? " (after due date)" : ""}` });
  return c.json(row, 201);
});

complianceRoutes.patch("/challans/:id", requirePerm("compliance", "edit"), vPatch(challanSchema.pick({ amountPaid: true, reference: true, paidOn: true, notes: true }).partial()), async (c) => {
  const [row] = await c
    .get("db")
    .update(statutoryChallans)
    .set(c.req.valid("json"))
    .where(and(eq(statutoryChallans.id, c.req.param("id")), eq(statutoryChallans.tenantId, tid(c))))
    .returning();
  if (!row) throw notFound("Payment");
  await audit(c, { action: "compliance.challan_update", entity: "statutory_challan", entityId: row.id, summary: `Updated ${STATUTE_LABELS[row.statute as Statute]} payment for ${monthLabel(row.period)}`, data: c.req.valid("json") });
  return c.json(row);
});

complianceRoutes.delete("/challans/:id", requirePerm("compliance", "configure"), async (c) => {
  const [row] = await c.get("db").delete(statutoryChallans).where(and(eq(statutoryChallans.id, c.req.param("id")), eq(statutoryChallans.tenantId, tid(c)))).returning();
  if (!row) throw notFound("Payment");
  await audit(c, { action: "compliance.challan_delete", entity: "statutory_challan", entityId: row.id, summary: `Removed ${STATUTE_LABELS[row.statute as Statute]} payment for ${monthLabel(row.period)}` });
  return c.json({ ok: true });
});

complianceRoutes.post("/challans/:id/receipt", requirePerm("compliance", "edit"), async (c) => {
  const db = c.get("db");
  const [row] = await db.select().from(statutoryChallans).where(and(eq(statutoryChallans.id, c.req.param("id")), eq(statutoryChallans.tenantId, tid(c))));
  if (!row) throw notFound("Payment");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach the challan receipt");
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest("Files must be 10 MB or smaller");
  if (!ALLOWED_TYPES.includes(file.type)) throw badRequest("Upload a PDF, PNG, JPG or WebP file");
  const key = `tenants/${tid(c)}/compliance/${row.statute}/${row.period}/${crypto.randomUUID()}-${safeName(file.name)}`;
  await putFile(c.env, key, await file.arrayBuffer(), file.type);
  const [updated] = await db.update(statutoryChallans).set({ receiptKey: key, receiptName: file.name }).where(eq(statutoryChallans.id, row.id)).returning();
  await audit(c, { action: "compliance.receipt", entity: "statutory_challan", entityId: row.id, summary: `Uploaded receipt for ${STATUTE_LABELS[row.statute as Statute]} ${monthLabel(row.period)}` });
  return c.json(updated);
});

complianceRoutes.get("/challans/:id/receipt", requirePerm("compliance", "view"), async (c) => {
  const [row] = await c.get("db").select().from(statutoryChallans).where(and(eq(statutoryChallans.id, c.req.param("id")), eq(statutoryChallans.tenantId, tid(c))));
  if (!row?.receiptKey) throw notFound("Receipt");
  const file = await getFile(c.env, row.receiptKey);
  if (!file) throw notFound("Receipt");
  return new Response(file.body as BodyInit, {
    headers: { "Content-Type": file.type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.receiptName ?? "receipt")}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});

// ---------------------------------------------------------------------------
// Employee-wise contributions and return files
// ---------------------------------------------------------------------------
async function lockedRun(c: Context<AppEnv>, month?: string) {
  const conds = [eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, LOCKED)];
  if (month) conds.push(eq(payrollRuns.month, month));
  const [run] = await c.get("db").select().from(payrollRuns).where(and(...conds)).orderBy(desc(payrollRuns.month)).limit(1);
  if (!run) throw notFound(month ? `Locked payroll for ${month}` : "Locked payroll");
  return run;
}

const monthQ = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

export function contributionRow(i: Item, pfOnFullBasic: boolean) {
  const basic = i.earnings.find((e) => e.code === "basic")?.amount ?? 0;
  const pfEe = line(i.deductions, "pf");
  const w = pfEe > 0 ? pfWages(basic, pfOnFullBasic) : { epf: 0, eps: 0, edli: 0 };
  return {
    employeeId: i.employeeId,
    name: i.snapshot.name,
    code: i.snapshot.code,
    uan: i.snapshot.uan,
    esicIpNumber: i.snapshot.esicIpNumber,
    pan: i.snapshot.pan,
    state: i.snapshot.state,
    gross: Number(i.gross),
    paidDays: Number(i.paidDays),
    ncpDays: Number(i.lopOverride ?? i.lopDays),
    pfWage: w.epf,
    epsWage: w.eps,
    edliWage: w.edli,
    epfEe: pfEe,
    eps: line(i.employer, "eps"),
    epfEr: line(i.employer, "epf_er"),
    edliAdmin: line(i.employer, "edli", "pf_admin"),
    esiEe: line(i.deductions, "esi"),
    esiEr: line(i.employer, "esi_er"),
    pt: line(i.deductions, "pt"),
    lwf: line(i.deductions, "lwf"),
    lwfEr: line(i.employer, "lwf_er"),
    tds: Number(i.tds),
    lastWorkingDay: i.snapshot.lastWorkingDay,
  };
}

complianceRoutes.get("/employee", requirePerm("compliance", "view"), v("query", monthQ), async (c) => {
  const run = await lockedRun(c, c.req.valid("query").month);
  const db = c.get("db");
  const template = await getTemplate(db, tid(c));
  const items = await db.select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(sql`${payrollItems.snapshot}->>'name'`);
  const months = await db.select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, LOCKED))).orderBy(desc(payrollRuns.month));
  const rows = items.map((i) => contributionRow(i, template.pfOnFullBasic));
  return c.json({
    month: run.month,
    months: months.map((m) => m.month),
    rows,
    missing: { uan: rows.filter((r) => r.epfEe > 0 && !r.uan).length, esicIp: rows.filter((r) => r.esiEe > 0 && !r.esicIpNumber).length, pan: rows.filter((r) => r.tds > 0 && !r.pan).length },
  });
});

const fileHeaders = (name: string, type: string, skipped = 0) => ({
  "Content-Type": type,
  "Content-Disposition": `attachment; filename="${name}"`,
  "X-Skipped-Count": String(skipped),
  "Access-Control-Expose-Headers": "X-Skipped-Count",
});

/** EPFO ECR 2.0 text file. Members without a UAN are left out (they need a UAN generated first). */
complianceRoutes.get("/files/ecr.txt", requirePerm("compliance", "export"), v("query", monthQ), async (c) => {
  const run = await lockedRun(c, c.req.valid("query").month);
  const db = c.get("db");
  const template = await getTemplate(db, tid(c));
  const items = await db.select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(sql`${payrollItems.snapshot}->>'code'`);
  const rows = items.map((i) => contributionRow(i, template.pfOnFullBasic)).filter((r) => r.epfEe > 0);
  const ok = rows.filter((r) => r.uan);
  const text = ok.map((r) => ecrLine({ uan: r.uan!, name: r.name, grossWages: r.gross, epfWages: r.pfWage, epsWages: r.epsWage, edliWages: r.edliWage, epfEe: r.epfEe, eps: r.eps, epfEr: r.epfEr, ncpDays: r.ncpDays })).join("\n");
  await audit(c, { action: "compliance.ecr", entity: "payroll_run", entityId: run.id, summary: `Generated ECR for ${monthLabel(run.month)}: ${ok.length} members` });
  return c.body(text + "\n", 200, fileHeaders(`ECR-${run.month}.txt`, "text/plain; charset=utf-8", rows.length - ok.length));
});

/** ESIC monthly contribution upload (the portal's template columns, as CSV). */
complianceRoutes.get("/files/esi.csv", requirePerm("compliance", "export"), v("query", monthQ), async (c) => {
  const run = await lockedRun(c, c.req.valid("query").month);
  const items = await c.get("db").select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(sql`${payrollItems.snapshot}->>'code'`);
  const rows = items.map((i) => contributionRow(i, false)).filter((r) => r.esiEe > 0 || r.esiEr > 0);
  const ok = rows.filter((r) => r.esicIpNumber);
  const csv = toCsv(
    ["IP Number", "IP Name", "No of Days for which wages paid/payable during the month", "Total Monthly Wages", "Reason Code for Zero workings days", "Last Working Day"],
    // Reason codes (only when days are 0): 2 = left service, 1 = on leave. Confirm against the ESIC portal's code list.
    ok.map((r) => {
      const left = !!r.lastWorkingDay && r.lastWorkingDay <= run.periodEnd;
      return [r.esicIpNumber, r.name, Math.floor(r.paidDays), Math.round(r.gross), left ? "2" : r.paidDays === 0 ? "1" : "", left ? r.lastWorkingDay!.split("-").reverse().join("/") : ""];
    }),
  );
  await audit(c, { action: "compliance.esi_file", entity: "payroll_run", entityId: run.id, summary: `Generated ESI return for ${monthLabel(run.month)}: ${ok.length} IPs` });
  return c.body(csv, 200, fileHeaders(`ESI-${run.month}.csv`, "text/csv; charset=utf-8", rows.length - ok.length));
});

/** PT return summary by slab, per state. */
complianceRoutes.get("/files/pt.csv", requirePerm("compliance", "export"), v("query", monthQ), async (c) => {
  const run = await lockedRun(c, c.req.valid("query").month);
  const items = await c.get("db").select().from(payrollItems).where(eq(payrollItems.runId, run.id));
  const rows = items.map((i) => contributionRow(i, false));
  const out: unknown[][] = [];
  for (const st of [...new Set(rows.map((r) => r.state ?? ""))]) {
    for (const s of ptSlabSummary(st, rows.filter((r) => (r.state ?? "") === st))) {
      out.push([st, s.from, s.upTo === Infinity ? "and above" : s.upTo, s.rate, s.employees, s.amount]);
    }
  }
  return c.body(toCsv(["State", "Monthly salary from", "Monthly salary up to", "Rate per employee", "Employees", "Tax deducted"], out), 200, fileHeaders(`PT-${run.month}.csv`, "text/csv; charset=utf-8"));
});

/** Employee-wise TDS deducted (feeds the 24Q annexure). */
complianceRoutes.get("/files/tds.csv", requirePerm("compliance", "export"), v("query", monthQ), async (c) => {
  const run = await lockedRun(c, c.req.valid("query").month);
  const items = await c.get("db").select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(sql`${payrollItems.snapshot}->>'code'`);
  const csv = toCsv(
    ["Employee ID", "Name", "PAN", "Regime", "Gross salary", "TDS deducted", "Date of payment"],
    items.map((i) => [i.snapshot.code, i.snapshot.name, i.snapshot.pan ?? "PANNOTAVBL", i.snapshot.regime, Number(i.gross), Number(i.tds), run.payDate ? fmtDate(run.payDate) : ""]),
  );
  return c.body(csv, 200, fileHeaders(`TDS-${run.month}.csv`, "text/csv; charset=utf-8"));
});

// ---------------------------------------------------------------------------
// Rules in force (read-only for now; versioned overrides come with the statutory master)
// ---------------------------------------------------------------------------
complianceRoutes.get("/rules", requirePerm("compliance", "view"), async (c) => {
  const db = c.get("db");
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tid(c)));
  const template = await getTemplate(db, tid(c));
  const states = [...new Set([t?.state, ...(await db.execute<{ state: string }>(sql`select distinct state from branches where tenant_id = ${tid(c)}`)).map((r) => r.state)].filter(Boolean) as string[])];
  const rules: { rule: string; value: string; scope: string; source: string }[] = [
    { rule: "EPF wage ceiling", value: inr(STATUTORY.pf.wageCeiling), scope: "All establishments", source: "EPF Scheme, from 01 Sep 2014" },
    { rule: "EPF contribution", value: template.pfOnFullBasic ? "12% + 12% on actual basic" : "12% + 12% on basic, capped", scope: t?.name ?? "Company", source: "Salary template" },
    { rule: "EPS / EDLI / admin", value: "8.33% (to ₹15,000) · 0.5% · 0.5%", scope: "All establishments", source: "EPF Scheme" },
    { rule: "ESI wage ceiling", value: inr(STATUTORY.esi.grossThreshold), scope: "All", source: "ESI Act, from 01 Jan 2017" },
    { rule: "ESI contribution", value: "0.75% employee · 3.25% employer", scope: "All", source: "ESI Act, from 01 Jul 2019" },
  ];
  for (const st of states) {
    const pt = PT_RULES[st];
    if (pt) rules.push({ rule: "Professional Tax slabs", value: pt.slabs.map(([up, amt], i, a) => (i === a.length - 1 ? `above ${inr(a[i - 1]?.[0] ?? 0)} → ${inr(amt)}` : `up to ${inr(up)} → ${inr(amt)}`)).join(" · ") + (pt.februaryTop ? ` (Feb ${inr(pt.februaryTop)})` : ""), scope: st, source: "State PT Act" });
    else rules.push({ rule: "Professional Tax", value: NO_PT_STATES.has(st) ? "Not levied" : "Not configured yet", scope: st, source: NO_PT_STATES.has(st) ? "No PT in this state" : "Contact support" });
    const lwf = LWF_RULES[st];
    if (lwf) rules.push({ rule: "Labour Welfare Fund", value: `${inr(lwf.employee)} employee + ${inr(lwf.employer)} employer, ${lwf.months.map((m) => new Date(2026, m - 1).toLocaleString("en-IN", { month: "short" })).join(" & ")}`, scope: st, source: "State LWF Act" });
  }
  rules.push(
    { rule: "Gratuity", value: "15/26 × last basic × completed years, after 5 years, cap ₹20 L", scope: "All", source: "Payment of Gratuity Act" },
    { rule: "Statutory bonus", value: "8.33% to 20% for wages up to ₹21,000", scope: "All", source: "Payment of Bonus Act" },
    { rule: "TDS on salary", value: "Average rate on projected income · new regime default", scope: "All", source: "Section 192, Income-tax Act" },
  );
  return c.json({ statutory: t?.statutory ?? {}, rules });
});
