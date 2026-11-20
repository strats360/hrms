import { describe, expect, it } from "vitest";
import { annuityRate, buildMudadSheet, checkMudad, computePayslip, packFor, resignationShare, saudiEndOfService, saudizationStatus, structureFromCtc, type PayslipInput } from "../src";

const slip = (o: Partial<PayslipInput> & { annual: number }) =>
  computePayslip({
    country: "SA",
    month: "2026-11",
    structure: structureFromCtc(o.annual, undefined, { pfApplicable: false, esiApplicable: false }),
    daysInMonth: 30,
    paidDays: 30,
    pfApplicable: false,
    esiApplicable: false,
    ptApplicable: false,
    state: null,
    regime: "new",
    ...o,
  });

describe("Saudi payroll", () => {
  it("takes nothing from an expat's pay; the employer pays 2% hazards on basic plus housing", () => {
    const p = slip({ annual: 240000, profile: { nationality: "IN", region: "Riyadh" } });
    expect(p.gross).toBe(20000);
    expect(p.deductions).toEqual([]);
    expect(p.employer).toEqual([{ code: "hazards_er", label: "GOSI occupational hazards (2%)", amount: 280 }]); // 2% of 10,000 + 4,000
    expect(p.net).toBe(20000);
    expect(p.tds).toBe(0);
  });
  it("puts Saudis into GOSI annuities and SANED, matched by the employer", () => {
    const p = slip({ annual: 240000, profile: { nationality: "SA", insuredSince: "2015-03-01" } });
    expect(p.deductions).toEqual([
      { code: "gosi", label: "GOSI annuities (9%)", amount: 1260 },
      { code: "saned", label: "SANED (0.75%)", amount: 105 },
    ]);
    expect(p.employer.map((l) => [l.code, l.amount])).toEqual([["gosi_er", 1260], ["saned_er", 105], ["hazards_er", 280]]);
    expect(p.net).toBe(18635);
  });
  it("steps up the annuity rate for people first insured under the new law", () => {
    expect(annuityRate("2026-11", "2014-01-01")).toBe(0.09);
    expect(annuityRate("2025-06", "2024-09-01")).toBe(0.09);
    expect(annuityRate("2025-07", "2024-09-01")).toBe(0.095);
    expect(annuityRate("2026-11", "2025-01-01")).toBe(0.1);
    expect(annuityRate("2030-01", "2025-01-01")).toBe(0.11);
    expect(slip({ annual: 240000, profile: { nationality: "SA", insuredSince: "2025-01-01" } }).deductions[0]).toMatchObject({ label: "GOSI annuities (10%)", amount: 1400 });
  });
  it("keeps the GOSI wage between SAR 1,500 and 45,000", () => {
    const high = slip({ annual: 1200000, profile: { nationality: "SA", insuredSince: "2010-01-01" } });
    expect(high.deductions[0]!.amount).toBe(4050);
    expect(high.warnings.join(" ")).toMatch(/capped at SAR 45,000/);
  });
  it("prorates for unpaid days, and flags what HR has to check", () => {
    expect(slip({ annual: 240000, paidDays: 15, profile: { nationality: "SA", insuredSince: "2010-01-01" } }).deductions[0]!.amount).toBe(630);
    expect(slip({ annual: 240000, profile: { nationality: "SA" } }).warnings.join(" ")).toMatch(/GOSI start date isn't set/);
    expect(slip({ annual: 240000, profile: { nationality: "KW" } }).warnings.join(" ")).toMatch(/GCC national/);
    expect(slip({ annual: 240000 }).warnings.join(" ")).toMatch(/Nationality isn't set/);
  });
});

describe("Saudi end of service", () => {
  it("pays half a month a year for five years and a month after, with no cap", () => {
    expect(saudiEndOfService(10000, 3 * 365).amount).toBe(15000);
    expect(saudiEndOfService(10000, 12 * 365).amount).toBe(95000);
    expect(saudiEndOfService(10000, 180).amount).toBe(2465.75); // part years pro rata
  });
  it("cuts the award on resignation by length of service", () => {
    expect(resignationShare(1.9)).toBe(0);
    expect(resignationShare(3)).toBe(1 / 3);
    expect(resignationShare(7)).toBe(2 / 3);
    expect(resignationShare(10)).toBe(1);
  });
  const base = { type: "resignation" as const, dateOfJoining: "2023-11-01", resignationDate: "2026-09-01", lastWorkingDay: "2026-10-31", monthlyBasic: 10000, monthlyGross: 15000, noticeDays: 60, noticeWaived: false, payInLieu: false, leave: [{ leaveTypeId: "al", name: "Annual leave", days: 10 }], manual: [], tds: 0 };
  it("settles a resignation after three years: a third of the award, leave on the full wage", () => {
    const s = packFor("SA").settlement(base);
    const g = s.lines.find((l) => l.key === "gratuity")!;
    expect(g.amount).toBeCloseTo((15000 * 0.5 * (1096 / 365)) / 3, 1);
    expect(g.note).toMatch(/a third on resignation/);
    expect(s.lines.find((l) => l.key === "encash:al")!.amount).toBe(5000); // 10 × 15,000 / 30
    expect(s.lines.some((l) => l.key === "notice_recovery")).toBe(false); // 61 days given
    expect(s.taxable).toBe(0);
  });
  it("pays the full award on termination, and none to someone who absconds", () => {
    const t = packFor("SA").settlement({ ...base, type: "termination" });
    expect(t.lines.find((l) => l.key === "gratuity")!.amount).toBeCloseTo(15000 * 0.5 * (1096 / 365), 1);
    expect(packFor("SA").settlement({ ...base, type: "absconding" }).gratuityEligible).toBe(false);
  });
});

describe("Mudad salary sheet", () => {
  const sheet = {
    establishmentId: "1-123456",
    month: "2026-11",
    employees: [
      { name: "Fahad Al Otaibi", idNumber: "1012345678", iban: "SA03 8000 0000 6080 1016 7519", basic: 10000, housing: 2500, otherEarnings: 1000, deductions: 1215, net: 12285 },
      { name: "Anil Kumar, Jr", idNumber: "2123456789", iban: "SA4420000001234567891234", basic: 6000, housing: 1500, otherEarnings: 0, deductions: 0, net: 7500 },
    ],
  };
  it("writes one row per employee", () => {
    const { fileName, content } = buildMudadSheet(sheet);
    expect(fileName).toBe("mudad-1-123456-2026-11.csv");
    const lines = content.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Employee ID,Employee name,IBAN,Basic salary,Housing allowance,Other earnings,Deductions,Net salary");
    expect(lines[1]).toBe("1012345678,Fahad Al Otaibi,SA0380000000608010167519,10000.00,2500.00,1000.00,1215.00,12285.00");
    expect(lines[2]).toBe('2123456789,"Anil Kumar, Jr",SA4420000001234567891234,6000.00,1500.00,0.00,0.00,7500.00');
  });
  it("names what's wrong before Mudad rejects it", () => {
    expect(checkMudad(sheet)).toEqual([]);
    const bad = checkMudad({ ...sheet, establishmentId: "abc", employees: [{ ...sheet.employees[0]!, idNumber: "99", iban: "AE00" }] });
    expect(bad).toEqual(expect.arrayContaining([expect.stringMatching(/establishment number/), expect.stringMatching(/Fahad Al Otaibi: add their national ID/), expect.stringMatching(/Fahad Al Otaibi: the IBAN/)]));
  });
});

describe("Saudization", () => {
  it("counts Saudis paid under SAR 4,000 as half, and under 3,000 not at all", () => {
    const s = saudizationStatus({ employees: 20, saudiWages: [8000, 5000, 3500, 2500] });
    expect(s).toMatchObject({ nationals: 4, counted: 2.5, belowFullWage: 2 });
    expect(s.share).toBe(0.125);
  });
});
