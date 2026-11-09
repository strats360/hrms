/**
 * Approval chains for leave and attendance corrections. A chain is an ordered list of
 * steps; a request is approved once every step has approved it, and rejected by any.
 * Steps nobody can fill (no manager on record) or that would land on the employee
 * themselves are skipped. HR can act on any step.
 */
export const APPROVAL_STEPS = ["manager", "skip_manager", "hr"] as const;
export type ApprovalStep = (typeof APPROVAL_STEPS)[number];
export const APPROVAL_STEP_LABELS: Record<ApprovalStep, string> = { manager: "Reporting manager", skip_manager: "Manager's manager", hr: "HR" };

export interface ApprovalPolicy {
  leave: { steps: ApprovalStep[]; longLeaveDays: number | null; longSteps: ApprovalStep[] };
  attendance: { steps: ApprovalStep[] };
}
export const DEFAULT_APPROVALS: ApprovalPolicy = {
  leave: { steps: ["manager"], longLeaveDays: null, longSteps: ["manager", "hr"] },
  attendance: { steps: ["manager"] },
};

export interface ResolvedStep {
  step: ApprovalStep;
  /** The employee who approves; null for HR (anyone with HR rights). */
  approverEmployeeId: string | null;
  approverName: string | null;
}

export interface ApprovalRecord {
  step: ApprovalStep;
  userId: string;
  name: string;
  at: string;
  decision: "approved" | "rejected";
  note?: string | null;
}

export function resolveChain(steps: ApprovalStep[], people: { employeeId: string; manager?: { id: string; name: string } | null; skipManager?: { id: string; name: string } | null }): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  for (const step of steps) {
    const who = step === "manager" ? people.manager : step === "skip_manager" ? people.skipManager : null;
    if (step !== "hr" && (!who || who.id === people.employeeId)) continue;
    const prev = out[out.length - 1];
    // the same person twice in a row approves once
    if (prev && step !== "hr" && prev.approverEmployeeId === who!.id) continue;
    if (prev && step === "hr" && prev.step === "hr") continue;
    out.push({ step, approverEmployeeId: step === "hr" ? null : who!.id, approverName: step === "hr" ? null : who!.name });
  }
  // nobody to ask: HR decides
  return out.length ? out : [{ step: "hr", approverEmployeeId: null, approverName: null }];
}

/** Which step the request is waiting on, given the approvals so far. */
export function currentStep(chain: ResolvedStep[], approvals: ApprovalRecord[]) {
  const done = approvals.filter((a) => a.decision === "approved").length;
  return done < chain.length ? { index: done, step: chain[done]!, last: done === chain.length - 1 } : null;
}

/** Can this person act on the step? HR can act on any step. */
export function canActOn(step: ResolvedStep, actor: { employeeId: string | null; isHr: boolean }) {
  return actor.isHr || (step.approverEmployeeId !== null && step.approverEmployeeId === actor.employeeId);
}

export const waitingLabel = (s: ResolvedStep) => (s.step === "hr" ? "HR" : `${s.approverName ?? APPROVAL_STEP_LABELS[s.step]}${s.step === "skip_manager" ? " (skip level)" : ""}`);
