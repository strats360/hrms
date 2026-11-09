import type { Context } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { employees, tenants, type Database } from "@hrms/db";
import { can, canActOn, currentStep, DEFAULT_APPROVALS, resolveChain, waitingLabel, type ApprovalPolicy, type ApprovalRecord, type ApprovalStep, type Module, type ResolvedStep } from "@hrms/shared";
import type { AppEnv } from "../env";
import { forbidden } from "../lib/errors";

export type ApprovalKind = "leave" | "attendance";

export async function approvalPolicy(db: Database, tenantId: string): Promise<ApprovalPolicy> {
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const p = (t?.s as { approvals?: Partial<ApprovalPolicy> } | undefined)?.approvals ?? {};
  return { leave: { ...DEFAULT_APPROVALS.leave, ...(p.leave ?? {}) }, attendance: { ...DEFAULT_APPROVALS.attendance, ...(p.attendance ?? {}) } };
}

const stepsFor = (p: ApprovalPolicy, kind: ApprovalKind, days?: number): ApprovalStep[] =>
  kind === "leave" ? (p.leave.longLeaveDays && (days ?? 0) > p.leave.longLeaveDays ? p.leave.longSteps : p.leave.steps) : p.attendance.steps;

/** The resolved chain for one employee's request. */
export async function chainFor(db: Database, tenantId: string, kind: ApprovalKind, employeeId: string, days?: number, policy?: ApprovalPolicy) {
  const p = policy ?? (await approvalPolicy(db, tenantId));
  const [e] = await db.select({ id: employees.id, managerId: employees.managerId }).from(employees).where(eq(employees.id, employeeId));
  const [m] = e?.managerId ? await db.select({ id: employees.id, name: employees.fullName, managerId: employees.managerId }).from(employees).where(eq(employees.id, e.managerId)) : [];
  const [sm] = m?.managerId ? await db.select({ id: employees.id, name: employees.fullName }).from(employees).where(eq(employees.id, m.managerId)) : [];
  return resolveChain(stepsFor(p, kind, days), { employeeId, manager: m ? { id: m.id, name: m.name } : null, skipManager: sm ? { id: sm.id, name: sm.name } : null });
}

/** "Waiting on" for a pending request, for lists. */
export function waitingOn(chain: ResolvedStep[], approvals: ApprovalRecord[]) {
  const cur = currentStep(chain, approvals);
  return cur ? { step: cur.step.step, label: waitingLabel(cur.step), approverEmployeeId: cur.step.approverEmployeeId, of: chain.length, at: cur.index + 1 } : null;
}

/**
 * Who an approver sees in their queue: HR sees everyone; managers see their direct reports,
 * and their reports' reports too when a chain has a skip-level step.
 */
export async function approvalScope(c: Context<AppEnv>, module: Module, kind: ApprovalKind): Promise<string[] | null> {
  const t = c.get("tenant");
  if (can(t.permissions, module, "configure")) return null;
  if (!t.employeeId) return [];
  const db = c.get("db");
  const direct = (await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, t.tenantId), eq(employees.managerId, t.employeeId)))).map((r) => r.id);
  const p = await approvalPolicy(db, t.tenantId);
  const skip = kind === "leave" ? [...p.leave.steps, ...(p.leave.longLeaveDays ? p.leave.longSteps : [])].includes("skip_manager") : p.attendance.steps.includes("skip_manager");
  if (!skip || !direct.length) return direct;
  const second = (await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, t.tenantId), inArray(employees.managerId, direct)))).map((r) => r.id);
  return [...new Set([...direct, ...second])];
}

/**
 * Record one approver's decision. Returns whether the request is now fully decided
 * (`final`) and the updated approvals. Throws when it isn't this person's turn.
 */
export async function recordDecision(c: Context<AppEnv>, module: Module, kind: ApprovalKind, req: { employeeId: string; approvals: ApprovalRecord[]; days?: number }, decision: "approved" | "rejected", note: string | null | undefined) {
  const t = c.get("tenant");
  const s = c.get("session")!;
  const chain = await chainFor(c.get("db"), t.tenantId, kind, req.employeeId, req.days);
  const cur = currentStep(chain, req.approvals);
  if (!cur) return { final: true, approvals: req.approvals, chain };
  const isHr = can(t.permissions, module, "configure");
  if (!canActOn(cur.step, { employeeId: t.employeeId ?? null, isHr })) throw forbidden(`This is waiting for ${waitingLabel(cur.step)}`);
  if (decision === "approved" && req.approvals.some((a) => a.userId === s.userId && a.decision === "approved")) throw forbidden(`You've already approved this. It now needs ${waitingLabel(cur.step)}.`);
  const approvals: ApprovalRecord[] = [...req.approvals, { step: cur.step.step, userId: s.userId, name: s.name, at: new Date().toISOString(), decision, note: note ?? null }];
  return { final: decision === "rejected" || cur.last, approvals, chain, next: decision === "approved" && !cur.last ? chain[cur.index + 1]! : null };
}
