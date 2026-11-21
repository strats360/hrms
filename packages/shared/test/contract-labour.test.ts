import { describe, expect, it } from "vitest";
import { contractLabourChecks } from "../src/contract-labour";

const many = (contractorId: string, n: number, extra = {}) => Array.from({ length: n }, () => ({ contractorId, joinedOn: "2026-04-01", dailyWage: 600, ...extra }));

describe("contract labour", () => {
  it("asks for a licence and registration at 50 workers", () => {
    const r = contractLabourChecks([{ id: "a", name: "Shree Facility" }], many("a", 52), [{ contractorId: "a", month: "2026-10", wagesPaidOn: "2026-11-05", pfChallan: "PF1", esiChallan: "ESI1" }], { today: "2026-11-21" });
    expect(r).toMatchObject({ total: 52, peak: 52, registrationNeeded: true });
    expect(r.rows[0]!.issues).toEqual(["52 workers: the contractor needs a licence"]);
  });
  it("chases wages, challans, expired licences, minimum wage and ended contracts", () => {
    const r = contractLabourChecks(
      [{ id: "a", name: "Shree Facility", labourLicence: "L-1", licenceValidUntil: "2026-06-30", contractTo: "2026-10-31" }],
      [...many("a", 3), ...many("a", 1, { dailyWage: 300 })],
      [],
      { today: "2026-11-21", minDailyWage: 450 },
    );
    expect(r.registrationNeeded).toBe(false);
    expect(r.rows[0]!.issues).toEqual([
      "The contractor's licence has expired",
      "The contract ended on 2026-10-31 but 4 workers are still on it",
      "1 worker is paid below the minimum wage",
      "2026-10 wages not confirmed paid; they were due by the 7th",
    ]);
    const m = contractLabourChecks([{ id: "a", name: "x" }], many("a", 2), [{ contractorId: "a", month: "2026-10", wagesPaidOn: "2026-11-04", pfChallan: "PF1" }], { today: "2026-11-21" });
    expect(m.rows[0]!.issues).toEqual(["Get the 2026-10 ESI challan from the contractor"]);
  });
  it("counts the peak over the last year", () => {
    const r = contractLabourChecks([{ id: "a", name: "x" }], many("a", 55, { leftOn: "2026-06-30" }), [], { today: "2026-11-21" });
    expect(r).toMatchObject({ total: 0, peak: 55, registrationNeeded: true });
  });
});
