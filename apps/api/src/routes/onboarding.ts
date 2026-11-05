import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { departments, designations, employeeDocuments, employees, onboardingInvites } from "@hrms/db";
import { ONBOARDING_STEP_LABELS, type OnboardingStep } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";

export const onboardingAdminRoutes = new Hono<AppEnv>();

const STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  opened: "Opened",
  in_progress: "In progress",
  submitted: "Awaiting verification",
  verified: "Verified",
  expired: "Expired",
};

/** New-joiner tracker. */
onboardingAdminRoutes.get("/", requirePerm("employees", "view"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const rows = await db
    .select({ inv: onboardingInvites, name: employees.fullName, code: employees.employeeCode, doj: employees.dateOfJoining, designation: designations.name, department: departments.name })
    .from(onboardingInvites)
    .innerJoin(employees, eq(employees.id, onboardingInvites.employeeId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(onboardingInvites.tenantId, tid))
    .orderBy(desc(onboardingInvites.sentAt));
  const now = new Date();
  const all = ["personal", "address", "bank", "tax", "documents"] as OnboardingStep[];
  const list = rows.map((r) => {
    const expired = r.inv.expiresAt < now && !["submitted", "verified"].includes(r.inv.status);
    const status = expired ? "expired" : r.inv.status;
    const pending = all.filter((s) => !r.inv.completedSteps.includes(s)).map((s) => ONBOARDING_STEP_LABELS[s]);
    return {
      employeeId: r.inv.employeeId,
      name: r.name,
      code: r.code,
      email: r.inv.email,
      designation: r.designation,
      department: r.department,
      dateOfJoining: r.doj,
      sentAt: r.inv.sentAt,
      progress: r.inv.progress,
      status,
      statusLabel: STATUS_LABEL[status] ?? status,
      pending: status === "verified" ? [] : status === "invited" ? ["Not opened"] : pending,
    };
  });
  const month = new Date().toISOString().slice(0, 7);
  return c.json({
    summary: {
      invited: list.filter((x) => x.status === "invited" || x.status === "opened").length,
      inProgress: list.filter((x) => x.status === "in_progress").length,
      awaiting: list.filter((x) => x.status === "submitted").length,
      joiningThisMonth: list.filter((x) => x.dateOfJoining.startsWith(month)).length,
    },
    rows: list,
  });
});

/** HR verifies a submitted onboarding and activates the employee. */
onboardingAdminRoutes.post(
  "/:employeeId/verify",
  requirePerm("employees", "edit"),
  v("json", z.object({ status: z.enum(["probation", "active"]).default("probation") })),
  async (c) => {
    const db = c.get("db");
    const tid = c.get("tenant").tenantId;
    const id = c.req.param("employeeId");
    const [inv] = await db.select().from(onboardingInvites).where(and(eq(onboardingInvites.tenantId, tid), eq(onboardingInvites.employeeId, id)));
    if (!inv) throw notFound("Onboarding");
    if (inv.status !== "submitted") throw badRequest("The employee hasn't submitted their details yet");
    await db.transaction(async (tx) => {
      await tx.update(onboardingInvites).set({ status: "verified", verifiedAt: new Date(), verifiedBy: c.get("session")!.userId, progress: 100 }).where(eq(onboardingInvites.id, inv.id));
      await tx.update(employees).set({ status: c.req.valid("json").status }).where(eq(employees.id, id));
      await tx.update(employeeDocuments).set({ status: "verified", verifiedBy: c.get("session")!.userId, verifiedAt: new Date() }).where(and(eq(employeeDocuments.employeeId, id), eq(employeeDocuments.status, "pending")));
    });
    await audit(c, { action: "onboarding.verify", entity: "employee", entityId: id, summary: "Verified onboarding and activated employee" });
    return c.json({ ok: true });
  },
);
