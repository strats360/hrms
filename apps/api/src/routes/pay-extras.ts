import { Hono, type Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { employees, leaveEncashments, leaveTypes, payrollRuns, tenants } from "@hrms/db";
import { inr, todayIST } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { monthLabel } from "../lib/months";
import { calculateRun } from "../services/payroll";
import { addEncashmentsToRun, cancelEncashment, closeLeaveYear, createEncashment, hasLeaveYear, overtimeForRun, setOvertime } from "../services/pay-extras";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;

async function openRun(c: Context<AppEnv>, id: string) {
  const [run] = await c.get("db").select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tid(c))));
  if (!run) throw notFound("Payroll run");
  return run;
}
const assertOpen = (run: typeof payrollRuns.$inferSelect) => {
  if (run.status === "approved" || run.status === "paid") throw badRequest("This payroll is locked");
  if (run.status === "draft") throw badRequest("Calculate the payroll first, so everyone in it is known");
};

// ---------------------------------------------------------------------------
// Payroll run: overtime and leave encashment
// ---------------------------------------------------------------------------
export const payrollExtrasRoutes = new Hono<AppEnv>();

payrollExtrasRoutes.get("/runs/:id/overtime", requirePerm("payroll", "view"), async (c) => {
  const run = await openRun(c, c.req.param("id"));
  return c.json(await overtimeForRun(c.get("db"), run));
});

/** Pay the approved overtime hours (edited where needed) in this run. Replaces earlier overtime lines. */
payrollExtrasRoutes.put("/runs/:id/overtime", requirePerm("payroll", "edit"), v("json", z.object({ rows: z.array(z.object({ employeeId: z.string(), hours: z.coerce.number().min(0).max(300) })).max(20000) })), async (c) => {
  const run = await openRun(c, c.req.param("id"));
  assertOpen(run);
  const db = c.get("db");
  const r = await setOvertime(db, run, c.req.valid("json").rows, uid(c));
  await calculateRun(db, tid(c), run.id, uid(c));
  await audit(c, { action: "payroll.overtime", entity: "payroll_run", entityId: run.id, summary: `Added overtime for ${r.employees} employee${r.employees === 1 ? "" : "s"} to ${monthLabel(run.month)} payroll (${inr(r.total)})` });
  return c.json(r);
});

payrollExtrasRoutes.post("/runs/:id/encashments", requirePerm("payroll", "edit"), async (c) => {
  const run = await openRun(c, c.req.param("id"));
  assertOpen(run);
  const db = c.get("db");
  const r = await addEncashmentsToRun(db, run, uid(c));
  if (!r.added) throw badRequest("No leave encashments are waiting for anyone in this payroll");
  await calculateRun(db, tid(c), run.id, uid(c));
  await audit(c, { action: "payroll.encashment", entity: "payroll_run", entityId: run.id, summary: `Added ${r.added} leave encashment${r.added === 1 ? "" : "s"} to ${monthLabel(run.month)} payroll (${inr(r.total)})` });
  return c.json(r);
});

// ---------------------------------------------------------------------------
// Leave: encashment and closing the year
// ---------------------------------------------------------------------------
export const leaveExtrasRoutes = new Hono<AppEnv>();

leaveExtrasRoutes.get("/encashments", requirePerm("leave", "view"), async (c) => {
  const status = c.req.query("status");
  const rows = await c
    .get("db")
    .select({ x: leaveEncashments, code: employees.employeeCode, name: employees.fullName, type: leaveTypes.name, runMonth: payrollRuns.month, runStatus: payrollRuns.status })
    .from(leaveEncashments)
    .innerJoin(employees, eq(employees.id, leaveEncashments.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveEncashments.leaveTypeId))
    .leftJoin(payrollRuns, eq(payrollRuns.id, leaveEncashments.runId))
    .where(and(eq(leaveEncashments.tenantId, tid(c)), status ? eq(leaveEncashments.status, status) : undefined))
    .orderBy(desc(leaveEncashments.createdAt))
    .limit(1000);
  return c.json(
    rows.map((r) => ({
      ...r.x,
      employeeCode: r.code,
      employeeName: r.name,
      leaveType: r.type,
      payrollMonth: r.runMonth,
      // paid once its payroll is
      state: r.x.status === "in_payroll" && r.runStatus === "paid" ? "paid" : r.x.status,
    })),
  );
});

leaveExtrasRoutes.post("/encashments", requirePerm("leave", "configure"), v("json", z.object({ employeeId: z.string().min(1), leaveTypeId: z.string().min(1), days: z.coerce.number().positive().max(365).multipleOf(0.5), note: z.string().trim().max(300).nullable().optional() })), async (c) => {
  const b = c.req.valid("json");
  let r;
  try {
    r = await createEncashment(c.get("db"), tid(c), b, uid(c));
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  await audit(c, { action: "leave.encash", entity: "leave_encashment", entityId: r.row.id, summary: `Encashed ${b.days} day${b.days === 1 ? "" : "s"} of ${r.type.name} for ${r.employee.fullName} (${inr(Number(r.row.amount))}), to be paid with the next payroll` });
  return c.json(r.row, 201);
});

leaveExtrasRoutes.post("/encashments/:id/cancel", requirePerm("leave", "configure"), async (c) => {
  const row = await cancelEncashment(c.get("db"), tid(c), c.req.param("id"));
  if (!row) throw badRequest("Only an encashment that isn't in a payroll yet can be cancelled. Remove it from the payroll first.");
  await audit(c, { action: "leave.encash_cancel", entity: "leave_encashment", entityId: row.id, summary: `Cancelled a leave encashment of ${row.days} days${row.reason === "request" ? "; the days are back on the balance" : ""}` });
  return c.json(row);
});

leaveExtrasRoutes.get("/year-close", requirePerm("leave", "view"), async (c) => {
  const [t] = await c.get("db").select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tid(c)));
  const closed = (t?.s as { leaveYearClosed?: number } | undefined)?.leaveYearClosed ?? null;
  const year = Number(todayIST().slice(0, 4));
  const open = closed === null || closed < year - 1;
  return c.json({ lastClosed: closed, due: open && (await hasLeaveYear(c.get("db"), tid(c), year - 1)) ? year - 1 : null });
});

leaveExtrasRoutes.post("/year-close", requirePerm("leave", "configure"), v("json", z.object({ year: z.coerce.number().int().min(2000).max(2100), encashLapsed: z.boolean().default(false), dryRun: z.boolean().default(true) })), async (c) => {
  const b = c.req.valid("json");
  const today = todayIST();
  const current = Number(today.slice(0, 4));
  if (b.year > current || (b.year === current && today < `${current}-12-01`)) throw badRequest(`Close ${b.year} from December onwards, when the year's leave is mostly settled`);
  if (!(await hasLeaveYear(c.get("db"), tid(c), b.year))) throw badRequest(`There are no leave balances for ${b.year} here, so there's nothing to carry forward. Set opening balances for ${b.year + 1} with Adjust balance instead.`);
  const r = await closeLeaveYear(c.get("db"), tid(c), b.year, { encashLapsed: b.encashLapsed, dryRun: b.dryRun }, uid(c));
  if (!b.dryRun) await audit(c, { action: "leave.year_close", entity: "leave_balance", summary: `Closed leave year ${b.year}: ${r.carriedDays} days carried into ${b.year + 1}, ${r.lapsedDays} lapsed${r.encashDays ? `, ${r.encashDays} encashed (${inr(r.encashAmount)})` : ""}` });
  return c.json(r);
});
