import { describe, expect, it } from "vitest";
import { contractorTds, sectionName } from "../src";

const base = { kind: "individual" as const, hasPan: true, fy: "2026-27", paidThisYear: 0, untaxedThisYear: 0 };

describe("TDS on contractors and professionals", () => {
  it("194C: 1% to individuals once a payment is over ₹30,000", () => {
    expect(contractorTds({ ...base, section: "194C", amount: 25000 }).tds).toBe(0);
    expect(contractorTds({ ...base, section: "194C", amount: 40000 })).toMatchObject({ rate: 0.01, tds: 400 });
    expect(contractorTds({ ...base, section: "194C", kind: "company", amount: 40000 }).tds).toBe(800);
  });
  it("194C: catches up earlier payments when the year goes over ₹1,00,000", () => {
    const r = contractorTds({ ...base, section: "194C", amount: 20000, paidThisYear: 90000, untaxedThisYear: 90000 });
    expect(r.tds).toBe(1100); // 1% of 20,000 + 90,000
    expect(r.note).toMatch(/including ₹90,000 paid earlier/);
  });
  it("194J: 10% for professional fees once the year is over ₹50,000, 2% for technical", () => {
    expect(contractorTds({ ...base, section: "194J_professional", amount: 40000 }).tds).toBe(0);
    expect(contractorTds({ ...base, section: "194J_professional", amount: 20000, paidThisYear: 40000, untaxedThisYear: 40000 }).tds).toBe(6000);
    expect(contractorTds({ ...base, section: "194J_technical", amount: 60000 }).tds).toBe(1200);
    expect(contractorTds({ ...base, section: "194J_professional", amount: 40000, fy: "2024-25" }).tds).toBe(4000); // ₹30,000 limit then
  });
  it("takes 20% without a PAN, and names the section by tax year", () => {
    expect(contractorTds({ ...base, section: "194C", amount: 40000, hasPan: false })).toMatchObject({ rate: 0.2, tds: 8000 });
    expect(sectionName("194J_professional", "2026-27")).toBe("393 (was 194J)");
    expect(sectionName("194C", "2025-26")).toBe("194C");
  });
});
