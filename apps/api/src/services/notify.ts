import type { Context } from "hono";
import { sendNotification } from "./notifications";
import { eq } from "drizzle-orm";
import { employees, leaveRequests, leaveTypes, tenants } from "@hrms/db";
import { fmtDate } from "@hrms/shared";
import type { AppEnv } from "../env";
import { layout } from "../lib/email";

/** Email the employee when their leave is approved or rejected. Best effort. */
export async function notifyLeaveDecision(c: Context<AppEnv>, req: typeof leaveRequests.$inferSelect) {
  try {
    const db = c.get("db");
    const [row] = await db
      .select({ email: employees.workEmail, first: employees.firstName, type: leaveTypes.name, company: tenants.name })
      .from(employees)
      .innerJoin(tenants, eq(tenants.id, employees.tenantId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, req.leaveTypeId))
      .where(eq(employees.id, req.employeeId));
    if (!row) return;
    const approved = req.status === "approved";
    const dates = req.startDate === req.endDate ? fmtDate(req.startDate) : `${fmtDate(req.startDate)} to ${fmtDate(req.endDate)}`;
    const { html, text } = layout({
      company: row.company,
      heading: `Your leave was ${approved ? "approved" : "not approved"}`,
      paragraphs: [
        `Hi ${row.first},`,
        `Your ${row.type} request ${req.code} for ${dates} (${req.days} day${Number(req.days) === 1 ? "" : "s"}) was ${approved ? "approved" : "rejected"}.`,
        ...(req.decisionNote ? [`Note from your approver: ${req.decisionNote}`] : []),
      ],
      cta: { label: "Open self-service", url: `${c.env.APP_URL}/me/leave` },
    });
    await sendNotification(c, "leave_decision", { to: row.email, subject: `Leave ${approved ? "approved" : "rejected"}: ${req.code}`, html, text });
  } catch (e) {
    console.error("notifyLeaveDecision failed", e);
  }
}
