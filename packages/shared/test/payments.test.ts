import { describe, expect, it } from "vitest";
import { bankSafe, buildBankFile, parseBankResponse, statutoryBonus, transferMode } from "../src/payments";

const debit = { accountNumber: "50200012345678", ifsc: "HDFC0000123" };
const line = { reference: "SAL-NOV26-0001", employeeCode: "STL-0042", beneficiaryName: "Priya Vaghela", accountNumber: "034501512345", ifsc: "ICIC0000345", amount: 48210.5, narration: "Salary Nov 2026", email: "priya@x.in" };

describe("bank files", () => {
  it("picks the transfer mode", () => {
    expect(transferMode("HDFC0000123", "HDFC0000999", 5000)).toBe("internal");
    expect(transferMode("HDFC0000123", "ICIC0000345", 199999)).toBe("neft");
    expect(transferMode("HDFC0000123", "ICIC0000345", 200000)).toBe("rtgs");
  });
  it("cleans names for bank files", () => {
    expect(bankSafe("Rāj & Sons, (Pvt)")).toBe("R J SONS PVT");
  });
  it("builds HDFC ENet rows", () => {
    const f = buildBankFile("hdfc_enet", debit, "2026-11-30", [line]);
    const cells = f.body.trim().split(",");
    expect(cells[0]).toBe("N");
    expect(cells[2]).toBe("034501512345");
    expect(cells[3]).toBe("48210.50");
    expect(cells[4]).toBe("PRIYA VAGHELA");
    expect(cells).toContain("SAL-NOV26-0001");
    expect(cells).toContain("30/11/2026");
    expect(f.ext).toBe("csv");
  });
  it("builds ICICI pipe rows and a generic CSV", () => {
    expect(buildBankFile("icici_cib", debit, "2026-11-30", [line]).body.trim()).toBe("NEFT|50200012345678|034501512345|PRIYA VAGHELA|48210.50|30/11/2026|ICIC0000345|SAL-NOV26-0001|SALARY NOV 2026");
    const g = buildBankFile("generic_csv", debit, "2026-11-30", [line]).body;
    expect(g.split("\r\n")[0]).toContain("Reference,Employee ID");
    expect(g).toContain("SAL-NOV26-0001,STL-0042,Priya Vaghela,034501512345");
  });
});

describe("bank response", () => {
  it("reads statuses, UTRs and reasons", () => {
    const r = parseBankResponse("Customer Reference,Amount,Status,UTR No,Reason\nSAL-1,100,SUCCESS,HDFCN1,\nSAL-2,200,Rejected,,Account dormant\nSAL-3,1,weird,,\n");
    expect(r.rows).toEqual([
      { reference: "SAL-1", status: "paid", utr: "HDFCN1", reason: null },
      { reference: "SAL-2", status: "failed", utr: null, reason: "Account dormant" },
    ]);
    expect(r.errors[0]).toMatch(/Row 4/);
  });
  it("handles pipe files and missing columns", () => {
    expect(parseBankResponse("Ref|Status\nA|Paid").rows[0]!.status).toBe("paid");
    expect(parseBankResponse("Amount,Name\n1,x").errors[0]).toMatch(/reference and status/);
  });
});

describe("statutory bonus", () => {
  it("is 8.33% of wages capped at ₹7,000 a month", () => {
    const r = statutoryBonus(Array.from({ length: 12 }, () => ({ wage: 12000, paidDays: 30 })));
    expect(r.eligible).toBe(true);
    expect(r.wageBase).toBe(84000);
    expect(r.amount).toBe(6997);
    expect(statutoryBonus(Array.from({ length: 12 }, () => ({ wage: 6000, paidDays: 30 })), 20).amount).toBe(14400);
  });
  it("skips employees above ₹21,000 or with under 30 days", () => {
    expect(statutoryBonus([{ wage: 22000, paidDays: 30 }]).eligible).toBe(false);
    expect(statutoryBonus([{ wage: 9000, paidDays: 20 }]).eligible).toBe(false);
  });
});
