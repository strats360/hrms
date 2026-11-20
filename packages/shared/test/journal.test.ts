import { describe, expect, it } from "vitest";
import { buildPayrollJournal, journalTotals, tallyJournalXml } from "../src/journal";

const items = [
  {
    department: "Engineering",
    earnings: [{ code: "basic", label: "Basic", amount: 25000 }, { code: "special", label: "Special", amount: 25000 }],
    deductions: [{ code: "pf", label: "Provident fund (employee)", amount: 3000 }, { code: "pt", label: "Professional tax", amount: 200 }, { code: "tds", label: "Income tax (TDS)", amount: 4000 }, { code: "adj_d0", label: "Salary advance", amount: 1000 }],
    employer: [{ code: "epf_er", label: "EPF (employer)", amount: 1250 }, { code: "eps", label: "EPS (pension)", amount: 1250 }, { code: "edli", label: "EDLI", amount: 75 }],
    reimbursement: 500,
    net: 50000 - 8200 + 500,
  },
  {
    department: "Sales",
    earnings: [{ code: "basic", label: "Basic", amount: 10000 }, { code: "special", label: "Special", amount: 8000 }],
    deductions: [{ code: "esi", label: "ESI (employee)", amount: 135 }, { code: "pt", label: "Professional tax", amount: 200 }],
    employer: [{ code: "esi_er", label: "ESI (employer)", amount: 585 }],
    reimbursement: 0,
    net: 18000 - 335,
  },
];

describe("payroll journal", () => {
  it("balances, and puts both shares of a scheme in one liability", () => {
    const lines = buildPayrollJournal(items, { loanLabels: new Set(["Salary advance"]) });
    const t = journalTotals(lines);
    expect(t.debit).toBe(t.credit);
    expect(t.debit).toBe(50000 + 18000 + 2575 + 585 + 500);
    const by = (a: string) => lines.find((l) => l.account === a);
    expect(by("Provident fund payable")).toMatchObject({ credit: 3000 + 2575, description: "Employee and employer shares" });
    expect(by("ESI payable")?.credit).toBe(720);
    expect(by("Professional tax payable")?.credit).toBe(400);
    expect(by("Staff loans and advances")?.credit).toBe(1000);
    expect(by("Salaries payable")?.credit).toBe(42300 + 17665);
  });
  it("splits costs by department and uses the company's account names", () => {
    const lines = buildPayrollJournal(items, { settings: { byDepartment: true, accounts: { salary_expense: "5100 Salaries" } } });
    expect(lines.filter((l) => l.account === "5100 Salaries").map((l) => [l.description, l.debit])).toEqual([["Gross pay · Engineering", 50000], ["Gross pay · Sales", 18000]]);
    const t = journalTotals(lines);
    expect(t.debit).toBe(t.credit);
  });
  it("names an unknown scheme's account after the line", () => {
    const lines = buildPayrollJournal([{ earnings: [{ code: "salary", label: "Salary", amount: 3000 }], deductions: [{ code: "ni", label: "National Insurance (employee)", amount: 200 }], employer: [{ code: "ni_er", label: "National Insurance (employer)", amount: 300 }], reimbursement: 0, net: 2800 }]);
    expect(lines.find((l) => l.account === "National Insurance payable")?.credit).toBe(500);
  });
  it("writes a Tally journal voucher", () => {
    const xml = tallyJournalXml(buildPayrollJournal(items), { date: "2026-11-30", narration: "Salary for November 2026 & arrears" });
    expect(xml).toMatch(/<DATE>20261130<\/DATE>/);
    expect(xml).toMatch(/<LEDGERNAME>Salaries and wages<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-68000.00<\/AMOUNT>/);
    expect(xml).toMatch(/November 2026 &amp; arrears/);
  });
});
