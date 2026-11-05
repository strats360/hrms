import { sql } from "drizzle-orm";
import { holidays, leaveTypes, memberships, roles, shifts, tenants, type Database } from "@hrms/db";
import { DEFAULT_ROLES } from "@hrms/shared";

export const DEFAULT_LEAVE_TYPES = [
  { code: "CL", name: "Casual leave", isPaid: true, annualQuota: 7, accrual: "yearly", carryForwardMax: 0, encashable: false },
  { code: "SL", name: "Sick leave", isPaid: true, annualQuota: 7, accrual: "yearly", carryForwardMax: 0, encashable: false },
  { code: "EL", name: "Earned leave", isPaid: true, annualQuota: 18, accrual: "monthly", carryForwardMax: 30, encashable: true },
  { code: "CO", name: "Compensatory off", isPaid: true, annualQuota: 0, accrual: "none", carryForwardMax: 0, encashable: false },
  { code: "LOP", name: "Unpaid leave", isPaid: false, annualQuota: 0, accrual: "none", carryForwardMax: 0, encashable: false },
] as const;

const NATIONAL_HOLIDAYS = (y: number) => [
  { date: `${y}-01-26`, name: "Republic Day", type: "national" },
  { date: `${y}-08-15`, name: "Independence Day", type: "national" },
  { date: `${y}-10-02`, name: "Gandhi Jayanti", type: "national" },
];

async function nextTenantCode(db: Database) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(tenants);
  return "TN-" + String((r?.n ?? 0) + 101).padStart(4, "0");
}

/**
 * Create a tenant with default roles, shift, leave types and national holidays,
 * and make `ownerUserId` its super admin.
 */
export async function provisionTenant(
  db: Database,
  input: { name: string; legalName?: string | null; state?: string | null; ownerUserId: string; plan?: string; status?: string; code?: string },
) {
  return db.transaction(async (tx) => {
    const code = input.code ?? (await nextTenantCode(tx as unknown as Database));
    const [tenant] = await tx
      .insert(tenants)
      .values({
        code,
        name: input.name,
        legalName: input.legalName ?? input.name,
        state: input.state ?? null,
        plan: input.plan ?? "trial",
        status: input.status ?? "trial",
        trialEndsAt: input.status === "active" ? null : new Date(Date.now() + 30 * 86400_000),
        settings: { payrollCycle: "calendar_month", payDay: "last_working_day", paidDaysBasis: "calendar", weeklyOffs: [0, 6] },
      })
      .returning();
    const t = tenant!;

    const roleRows = await tx
      .insert(roles)
      .values(
        DEFAULT_ROLES.map((r) => ({
          tenantId: t.id,
          key: r.key,
          name: r.name,
          description: r.description,
          isSystem: true,
          permissions: r.permissions,
        })),
      )
      .returning();
    const superAdmin = roleRows.find((r) => r.key === "super_admin")!;

    await tx.insert(shifts).values({
      tenantId: t.id,
      name: "General",
      startTime: "09:00",
      endTime: "18:00",
      graceMinutes: 15,
      halfDayMinutes: 240,
      fullDayMinutes: 480,
      weeklyOffs: [0, 6],
      isDefault: true,
    });

    await tx.insert(leaveTypes).values(DEFAULT_LEAVE_TYPES.map((l) => ({ ...l, tenantId: t.id })));

    const y = new Date().getUTCFullYear();
    await tx.insert(holidays).values([...NATIONAL_HOLIDAYS(y), ...NATIONAL_HOLIDAYS(y + 1)].map((h) => ({ ...h, tenantId: t.id })));

    await tx.insert(memberships).values({ tenantId: t.id, userId: input.ownerUserId, roleId: superAdmin.id, status: "active" });

    return { tenant: t, roles: roleRows };
  });
}
