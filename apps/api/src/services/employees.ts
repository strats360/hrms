import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { employees, memberships, onboardingInvites, tenants, user, departments, designations, type Database } from "@hrms/db";
import { encryptField, fmtDate, randomToken, sha256Hex } from "@hrms/shared";
import type { AppEnv } from "../env";
import { layout } from "../lib/email";

export async function nextEmployeeCode(db: Database, tenantId: string) {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const prefix = t?.settings?.employeeCodePrefix ?? "EMP";
  const [r] = await db
    .select({
      n: sql<number>`coalesce(max(nullif(regexp_replace(${employees.employeeCode}, '\\D', '', 'g'), '')::int), 0)::int`,
    })
    .from(employees)
    .where(eq(employees.tenantId, tenantId));
  return `${prefix}-${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

/** Split bank account into encrypted value + last 4 for display. */
export async function bankFields(accountNumber: string | null | undefined, key: string) {
  if (accountNumber === undefined) return {};
  if (!accountNumber) return { accountNumberEnc: null, accountLast4: null };
  return { accountNumberEnc: await encryptField(accountNumber, key), accountLast4: accountNumber.slice(-4) };
}

/** If someone in this tenant already logs in with this email, link their login to the employee. */
export async function linkExistingLogin(db: Database, tenantId: string, employeeId: string, email: string) {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
  if (!u) return false;
  const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, u.id)));
  if (!m) return false;
  await db.update(memberships).set({ employeeId }).where(eq(memberships.id, m.id));
  await db.update(employees).set({ userId: u.id }).where(eq(employees.id, employeeId));
  return true;
}

/** Create (or refresh) a self-onboarding invite and email it. Returns the raw token (for tests/dev). */
export async function sendOnboardingInvite(c: Context<AppEnv>, employeeId: string) {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [row] = await db
    .select({ emp: employees, tenantName: tenants.name, dept: departments.name, desig: designations.name })
    .from(employees)
    .innerJoin(tenants, eq(tenants.id, employees.tenantId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tid)));
  if (!row) throw new Error("employee not found");
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 7 * 86400_000);
  const [existing] = await db.select().from(onboardingInvites).where(and(eq(onboardingInvites.tenantId, tid), eq(onboardingInvites.employeeId, employeeId)));
  if (existing) {
    await db
      .update(onboardingInvites)
      .set({ tokenHash, expiresAt, sentAt: new Date(), email: row.emp.workEmail, status: existing.status === "expired" ? "invited" : existing.status })
      .where(eq(onboardingInvites.id, existing.id));
  } else {
    await db.insert(onboardingInvites).values({ tenantId: tid, employeeId, email: row.emp.workEmail, tokenHash, expiresAt });
  }
  const url = `${c.env.APP_URL}/onboarding/${token}`;
  const role = row.desig ? ` as ${row.desig}${row.dept ? ` in ${row.dept}` : ""}` : row.dept ? ` in the ${row.dept} team` : "";
  const { html, text } = layout({
    company: row.tenantName,
    heading: `Welcome to ${row.tenantName}, ${row.emp.firstName}. Complete your joining details`,
    paragraphs: [
      `Hi ${row.emp.firstName},`,
      `We're glad you're joining${role}, starting ${fmtDate(row.emp.dateOfJoining)}.`,
      "Please complete your joining details so we can set up payroll, PF and your first payslip. It takes about 8 minutes. Keep these handy: PAN, Aadhaar, bank account details (cancelled cheque or passbook), UAN if you had PF before, and education certificates.",
    ],
    cta: { label: "Start onboarding", url },
    footer: `This secure link is only for you and expires on ${fmtDate(expiresAt.toISOString())}. Questions? Reply to this email.`,
  });
  await c.get("mailer").send({ to: row.emp.workEmail, subject: `Welcome to ${row.tenantName}: complete your joining details`, html, text });
  return token;
}
