import { and, eq, gte, inArray, lte, ne, notInArray, sql } from "drizzle-orm";
import { fbpDeclarations, payrollItems, payrollRuns, reimbursementCategories, reimbursementClaims, tenants, type Database } from "@hrms/db";
import type { FbpAllocations, FbpSettings } from "@hrms/shared";

/** The company's flexible benefit plan, or null when it's off. */
export async function fbpSettings(db: Database, tenantId: string): Promise<FbpSettings | null> {
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const f = t?.s?.fbp;
  return f?.enabled && f.heads.length ? f : null;
}

/** 2026-27 runs from 1 April 2026 to 31 March 2027. */
export function fyDates(fy: string) {
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31`, fromMonth: `${y}-04`, toMonth: `${y + 1}-03` };
}

/** Approved plans for the year. */
export async function approvedPlans(db: Database, tenantId: string, fy: string, ids: string[]) {
  const out = new Map<string, FbpAllocations>();
  if (!ids.length) return out;
  const rows = await db
    .select({ e: fbpDeclarations.employeeId, a: fbpDeclarations.allocations })
    .from(fbpDeclarations)
    .where(and(eq(fbpDeclarations.tenantId, tenantId), eq(fbpDeclarations.fy, fy), eq(fbpDeclarations.status, "approved"), inArray(fbpDeclarations.employeeId, ids)));
  for (const r of rows) out.set(r.e, r.a);
  return out;
}

const add = (m: Map<string, FbpAllocations>, e: string, head: string, n: number) => {
  const cur = m.get(e) ?? {};
  cur[head] = Math.round(((cur[head] ?? 0) + n) * 100) / 100;
  m.set(e, cur);
};

/** What payroll has credited so far this year per head, leaving out one run (the one being calculated). */
export async function creditedSoFar(db: Database, tenantId: string, fy: string, ids: string[], exceptRunId?: string) {
  const out = new Map<string, FbpAllocations>();
  if (!ids.length) return out;
  const d = fyDates(fy);
  const rows = await db
    .select({ e: payrollItems.employeeId, c: payrollItems.fbpCredit })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(
      and(
        eq(payrollItems.tenantId, tenantId),
        inArray(payrollItems.employeeId, ids),
        gte(payrollRuns.month, d.fromMonth),
        lte(payrollRuns.month, d.toMonth),
        sql`${payrollItems.fbpCredit} is not null`,
        ...(exceptRunId ? [ne(payrollRuns.id, exceptRunId)] : []),
      ),
    );
  for (const r of rows) for (const [h, n] of Object.entries(r.c ?? {})) add(out, r.e, h, n);
  return out;
}

/** Claims against each head this year. Pending ones count too, so a balance can't be claimed twice. */
export async function claimedSoFar(db: Database, tenantId: string, fy: string, ids: string[], opts: { approvedOnly?: boolean; exceptClaimId?: string } = {}) {
  const out = new Map<string, FbpAllocations>();
  if (!ids.length) return out;
  const d = fyDates(fy);
  const rows = await db
    .select({ e: reimbursementClaims.employeeId, h: reimbursementCategories.fbpHead, amount: reimbursementClaims.amount })
    .from(reimbursementClaims)
    .innerJoin(reimbursementCategories, eq(reimbursementCategories.id, reimbursementClaims.categoryId))
    .where(
      and(
        eq(reimbursementClaims.tenantId, tenantId),
        inArray(reimbursementClaims.employeeId, ids),
        sql`${reimbursementCategories.fbpHead} is not null`,
        gte(reimbursementClaims.expenseDate, d.from),
        lte(reimbursementClaims.expenseDate, d.to),
        opts.approvedOnly ? inArray(reimbursementClaims.status, ["approved", "paid"]) : notInArray(reimbursementClaims.status, ["rejected", "cancelled"]),
        ...(opts.exceptClaimId ? [ne(reimbursementClaims.id, opts.exceptClaimId)] : []),
      ),
    );
  for (const r of rows) if (r.h) add(out, r.e, r.h, Number(r.amount));
  return out;
}

/** Built up, claimed and left per head for one employee. */
export async function fbpBalances(db: Database, tenantId: string, employeeId: string, fy: string) {
  const [credited, claimed] = await Promise.all([creditedSoFar(db, tenantId, fy, [employeeId]), claimedSoFar(db, tenantId, fy, [employeeId])]);
  const c = credited.get(employeeId) ?? {};
  const k = claimed.get(employeeId) ?? {};
  const heads = new Set([...Object.keys(c), ...Object.keys(k)]);
  return Object.fromEntries([...heads].map((h) => [h, { credited: c[h] ?? 0, claimed: k[h] ?? 0, balance: Math.round(((c[h] ?? 0) - (k[h] ?? 0)) * 100) / 100 }]));
}
