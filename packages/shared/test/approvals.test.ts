import { describe, expect, it } from "vitest";
import { canActOn, currentStep, resolveChain, type ApprovalRecord } from "../src/approvals";

const people = { employeeId: "e1", manager: { id: "m1", name: "Hardik" }, skipManager: { id: "m2", name: "Kunal" } };
const rec = (step: ApprovalRecord["step"]): ApprovalRecord => ({ step, userId: "u", name: "x", at: "", decision: "approved" });

describe("approval chains", () => {
  it("resolves the people for each step", () => {
    expect(resolveChain(["manager", "skip_manager", "hr"], people).map((s) => [s.step, s.approverEmployeeId])).toEqual([["manager", "m1"], ["skip_manager", "m2"], ["hr", null]]);
  });
  it("skips steps nobody can fill, and falls back to HR", () => {
    expect(resolveChain(["manager", "skip_manager"], { employeeId: "e1", manager: { id: "m1", name: "H" } }).map((s) => s.step)).toEqual(["manager"]);
    expect(resolveChain(["manager"], { employeeId: "e1" }).map((s) => s.step)).toEqual(["hr"]);
    // a manager who reports to themselves, or the same person twice
    expect(resolveChain(["manager", "skip_manager"], { employeeId: "e1", manager: { id: "m1", name: "H" }, skipManager: { id: "m1", name: "H" } })).toHaveLength(1);
    expect(resolveChain(["skip_manager"], { employeeId: "e1", skipManager: { id: "e1", name: "Self" } }).map((s) => s.step)).toEqual(["hr"]);
  });
  it("walks the chain and says who may act", () => {
    const chain = resolveChain(["manager", "hr"], people);
    expect(currentStep(chain, [])).toMatchObject({ index: 0, last: false });
    expect(currentStep(chain, [rec("manager")])).toMatchObject({ index: 1, last: true });
    expect(currentStep(chain, [rec("manager"), rec("hr")])).toBeNull();
    expect(canActOn(chain[0]!, { employeeId: "m1", isHr: false })).toBe(true);
    expect(canActOn(chain[0]!, { employeeId: "m2", isHr: false })).toBe(false);
    expect(canActOn(chain[1]!, { employeeId: "m1", isHr: false })).toBe(false);
    expect(canActOn(chain[0]!, { employeeId: null, isHr: true })).toBe(true);
  });
});
