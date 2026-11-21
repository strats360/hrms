import { describe, expect, it } from "vitest";
import { caseDeadlines, committeeProblems, poshAnnualReport, type CommitteeMember } from "../src/committees";

const ic: CommitteeMember[] = [
  { employeeId: "e1", role: "presiding", gender: "female" },
  { employeeId: "e2", role: "member", gender: "female" },
  { employeeId: "e3", role: "member", gender: "male" },
  { name: "Asha Mehta", organisation: "Sakhi Trust", role: "external", gender: "female" },
];

describe("committees", () => {
  it("checks a POSH Internal Committee", () => {
    expect(committeeProblems({ kind: "posh_ic", members: ic, constitutedOn: "2026-01-01" }, { today: "2026-11-21" })).toEqual([]);
    const bad = committeeProblems({ kind: "posh_ic", members: [{ employeeId: "e3", role: "presiding", gender: "male" }, { employeeId: "e4", role: "member", gender: "male" }], constitutedOn: "2026-01-01", termEndsOn: "2030-01-01" }, { today: "2026-11-21" });
    expect(bad).toEqual(["The presiding officer must be a senior woman employee", "Add at least two employee members", "Add an external member from an NGO or someone familiar with sexual harassment issues", "At least half the members must be women", "A member's term can be at most three years"]);
    expect(committeeProblems({ kind: "posh_ic", members: ic, constitutedOn: "2022-01-01" }, { today: "2026-11-21" })).toContain("The committee's term has ended; reconstitute it");
  });
  it("checks a Grievance Redressal Committee", () => {
    const grc: CommitteeMember[] = [
      { employeeId: "a", role: "chair", gender: "male", side: "employer" },
      { employeeId: "b", role: "member", gender: "female", side: "worker" },
    ];
    expect(committeeProblems({ kind: "grc", members: grc, constitutedOn: "2026-01-01" })).toEqual([]);
    expect(committeeProblems({ kind: "grc", members: [...grc, { employeeId: "c", role: "member", gender: "male", side: "worker" }], constitutedOn: "2026-01-01" })).toEqual(["It needs the same number of members from the employer and the workers"]);
  });
  it("works out deadlines", () => {
    expect(caseDeadlines("posh_ic", { filedOn: "2026-11-01", incidentDate: "2026-10-20" })).toMatchObject({ lateFiling: false, inquiryBy: "2027-01-30", reportBy: "2027-02-09" });
    expect(caseDeadlines("posh_ic", { filedOn: "2026-11-01", incidentDate: "2026-06-01" }).filingNote).toMatch(/over three months/);
    expect(caseDeadlines("posh_ic", { filedOn: "2026-11-01", reportOn: "2026-12-15" }).actionBy).toBe("2027-02-13");
    expect(caseDeadlines("grc", { filedOn: "2026-11-01" })).toMatchObject({ inquiryBy: "2026-12-01" });
  });
  it("builds the POSH annual report", () => {
    const r = poshAnnualReport(2026, [
      { filedOn: "2026-02-01", status: "closed", closedOn: "2026-04-10" },
      { filedOn: "2026-08-01", status: "inquiry" },
      { filedOn: "2026-12-20", status: "received" },
      { filedOn: "2025-11-01", status: "closed", closedOn: "2026-01-15" },
    ], [{ date: "2026-03-08" }, { date: "2025-12-01" }]);
    expect(r).toEqual({ year: 2026, received: 3, disposed: 2, pending: 2, pendingOver90Days: 1, workshops: 1 });
  });
});
