import { Hono } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { attendanceCorrections, departments, employees, leaveRequests, leaveTypes, onboardingInvites, reimbursementClaims } from "@hrms/db";
import { can, todayIST } from "@hrms/shared";
import type { AppEnv } from "../env";
import { buildCalendar } from "../services/attendance";
import { teamScope } from "../services/scope";
import { isFinance } from "../services/reimbursements";

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/", async (c) => {
  const db = c.get("db");
  const t = c.get("tenant");
  const tid = t.tenantId;
  const today = todayIST();

  const counts = await db
    .select({ status: employees.status, n: sql<number>`count(*)::int` })
    .from(employees)
    .where(eq(employees.tenantId, tid))
    .groupBy(employees.status);
  const n = (...s: string[]) => counts.filter((x) => s.includes(x.status)).reduce((a, b) => a + b.n, 0);

  let attendance = null;
  if (can(t.permissions, "attendance", "view")) {
    const scope = await teamScope(c, "attendance");
    const emps = await db
      .select({ id: employees.id, shiftId: employees.shiftId, branchId: employees.branchId, dateOfJoining: employees.dateOfJoining, lastWorkingDay: employees.lastWorkingDay })
      .from(employees)
      .where(and(eq(employees.tenantId, tid), sql`${employees.status} not in ('exited','inactive','onboarding')`, ...(scope ? [inArray(employees.id, scope.length ? scope : ["-"])] : [])));
    const cal = await buildCalendar(db, tid, emps, today, today);
    const st = emps.map((e) => cal.status(e, today));
    const k = (...s: string[]) => st.filter((x) => x && s.includes(x)).length;
    attendance = { present: k("present", "late", "wfh", "half_day"), wfh: k("wfh"), late: k("late"), absent: k("absent"), notMarked: k("not_marked"), onLeave: k("on_leave"), off: k("weekly_off", "holiday") };
  }

  let pendingLeaves: unknown[] = [];
  let pendingLeaveCount = 0;
  if (can(t.permissions, "leave", "view")) {
    const scope = await teamScope(c, "leave");
    const conds = [eq(leaveRequests.tenantId, tid), eq(leaveRequests.status, "pending")];
    if (scope) conds.push(inArray(leaveRequests.employeeId, scope.length ? scope : ["-"]));
    const rows = await db
      .select({ id: leaveRequests.id, code: leaveRequests.code, employeeId: leaveRequests.employeeId, employeeName: employees.fullName, employeeCode: employees.employeeCode, type: leaveTypes.name, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, days: leaveRequests.days })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(...conds))
      .orderBy(asc(leaveRequests.startDate));
    pendingLeaveCount = rows.length;
    pendingLeaves = rows.filter((r) => r.employeeId !== t.employeeId).slice(0, 6);
  }

  const [corr] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendanceCorrections)
    .where(and(eq(attendanceCorrections.tenantId, tid), eq(attendanceCorrections.status, "pending")));
  const [ob] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(onboardingInvites)
    .where(and(eq(onboardingInvites.tenantId, tid), eq(onboardingInvites.status, "submitted")));

  // Claims this user can act on now: manager stage for their reports (or all, for admins), finance stage for finance
  let pendingClaimCount = 0;
  if (can(t.permissions, "reimbursements", "approve")) {
    const admin = can(t.permissions, "reimbursements", "configure");
    const stages = [
      admin ? sql`${reimbursementClaims.status} = 'pending_manager'` : sql`(${reimbursementClaims.status} = 'pending_manager' and ${employees.managerId} = ${t.employeeId ?? "-"})`,
      ...(isFinance(t.permissions) ? [sql`${reimbursementClaims.status} = 'pending_finance'`] : []),
    ];
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reimbursementClaims)
      .innerJoin(employees, eq(employees.id, reimbursementClaims.employeeId))
      .where(and(eq(reimbursementClaims.tenantId, tid), sql`${reimbursementClaims.employeeId} <> ${t.employeeId ?? "-"}`, sql`(${sql.join(stages, sql` or `)})`));
    pendingClaimCount = r?.n ?? 0;
  }

  // Birthdays and work anniversaries in the next 14 days
  const celebrations = await db.execute<{ id: string; name: string; department: string | null; kind: string; date: string; years: number }>(sql`
    with e as (
      select ${employees.id} as id, ${employees.fullName} as name, ${departments.name} as department,
             ${employees.dateOfBirth} as dob, ${employees.dateOfJoining} as doj
      from ${employees} left join ${departments} on ${departments.id} = ${employees.departmentId}
      where ${employees.tenantId} = ${tid} and ${employees.status} not in ('exited','inactive')
    ), d as (select generate_series(${today}::date, ${today}::date + 13, interval '1 day')::date as day)
    select e.id, e.name, e.department, 'birthday' as kind, d.day::text as date, 0 as years
      from e join d on e.dob is not null and extract(month from e.dob) = extract(month from d.day) and extract(day from e.dob) = extract(day from d.day)
    union all
    select e.id, e.name, e.department, 'anniversary' as kind, d.day::text as date, (extract(year from d.day) - extract(year from e.doj))::int as years
      from e join d on extract(month from e.doj) = extract(month from d.day) and extract(day from e.doj) = extract(day from d.day) and d.day > e.doj
    order by date, name limit 8`);

  return c.json({
    date: today,
    employees: { total: counts.reduce((a, b) => a + b.n, 0), active: n("active", "probation", "notice"), inactive: n("inactive", "exited"), onboarding: n("onboarding"), probation: n("probation") },
    attendance,
    pendingLeaveCount,
    pendingLeaves,
    pendingCorrections: corr?.n ?? 0,
    pendingClaimCount,
    awaitingVerification: ob?.n ?? 0,
    celebrations: [...celebrations],
  });
});
