import { describe, expect, it } from "vitest";
import { bahrainIndemnity, buildQatarWps, checkQatarWps, computePayslip, kuwaitIndemnity, kuwaitResignationShare, omanGratuity, packFor, qatarGratuity, structureFromCtc, type CountryCode, type PayslipInput } from "../src";

const slip = (country: CountryCode, o: Partial<PayslipInput> & { annual: number }) =>
  computePayslip({
    country,
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
const lines = (l: { code: string; amount: number }[]) => l.map((x) => [x.code, x.amount]);
const exit = { type: "termination" as const, dateOfJoining: "2023-11-01", resignationDate: "2026-10-01", lastWorkingDay: "2026-10-31", monthlyBasic: 10000, monthlyGross: 20000, noticeDays: 30, noticeWaived: false, payInLieu: false, leave: [], manual: [], tds: 0 };

describe("Qatar", () => {
  it("puts Qataris into GRSIA on basic plus housing, and takes nothing from expats", () => {
    const q = slip("QA", { annual: 240000, profile: { nationality: "QA" } });
    expect(lines(q.deductions)).toEqual([["pension", 980]]);
    expect(lines(q.employer)).toEqual([["pension_er", 1960]]);
    const x = slip("QA", { annual: 240000, profile: { nationality: "PH" } });
    expect(x.deductions).toEqual([]);
    expect(x.net).toBe(20000);
    expect(slip("QA", { annual: 240000, profile: { nationality: "SA" } }).warnings.join(" ")).toMatch(/GCC national/);
  });
  it("pays three weeks' basic a year after the first year, with no cut on resignation", () => {
    expect(qatarGratuity(10000, 300)).toBeNull();
    expect(qatarGratuity(10000, 3 * 365)!.amount).toBe(21000);
    const s = packFor("QA").settlement({ ...exit, type: "resignation" });
    expect(s.lines.find((l) => l.key === "gratuity")!.amount).toBeCloseTo((10000 / 30) * 21 * (1096 / 365), 1);
    expect(packFor("QA").settlement({ ...exit, profile: { nationality: "QA" } }).gratuityEligible).toBe(false);
  });
  it("writes the WPS file and checks it", () => {
    const f = {
      employerId: "123456",
      payerBank: "qnb",
      payerIban: "QA58 DOHB 0000 1234 5678 90AB CDEF G",
      month: "2026-11",
      createdAt: new Date("2026-11-28T09:30:00Z"),
      employees: [{ name: "Maria Santos", qid: "28460800000", bank: "CBQ", iban: "QA57CITI000010777100000000012", workingDays: 30, net: 6500, basic: 4000, extraHours: 0, extraIncome: 500, deductions: 0 }],
    };
    expect(checkQatarWps(f)).toEqual([]);
    const { fileName, content } = buildQatarWps(f);
    expect(fileName).toBe("SIF_123456_QNB_20261128_0930.csv");
    const rows = content.trimEnd().split("\r\n");
    expect(rows[1]).toBe("123456,20261128,0930,123456,,QNB,QA58DOHB00001234567890ABCDEFG,202611,6500.00,1,1");
    expect(rows[3]).toBe("000001,28460800000,,Maria Santos,CBQ,QA57CITI000010777100000000012,M,30,6500.00,4000.00,0,500.00,0.00,Normal Payment,");
    expect(checkQatarWps({ ...f, employees: [{ ...f.employees[0]!, qid: "1", iban: "AE00" }] })).toEqual(expect.arrayContaining([expect.stringMatching(/Maria Santos: add their Qatar ID/), expect.stringMatching(/Maria Santos: the IBAN/)]));
  });
});

describe("Kuwait", () => {
  it("puts Kuwaitis into PIFSS up to KWD 2,750, in fils", () => {
    const k = slip("KW", { annual: 24000, profile: { nationality: "KW" } });
    expect(lines(k.deductions)).toEqual([["pension", 210]]);
    expect(lines(k.employer)).toEqual([["pension_er", 230]]);
    expect(slip("KW", { annual: 60000, profile: { nationality: "KW" } }).deductions[0]!.amount).toBe(288.75);
    expect(slip("KW", { annual: 24000, profile: { nationality: "EG" } }).deductions).toEqual([]);
  });
  it("pays 15 days a year for five years and a month after, capped at 18 months, cut on early resignation", () => {
    expect(kuwaitIndemnity(2000, 3 * 365).amount).toBe(3000);
    expect(kuwaitIndemnity(2000, 12 * 365).amount).toBe(19000);
    expect(kuwaitIndemnity(2000, 30 * 365).amount).toBe(36000);
    expect([2, 4, 7, 11].map(kuwaitResignationShare)).toEqual([0, 0.5, 2 / 3, 1]);
    const s = packFor("KW").settlement({ ...exit, type: "resignation", monthlyGross: 2000 });
    expect(s.lines.find((l) => l.key === "gratuity")!.note).toMatch(/half on resignation/);
  });
});

describe("Oman", () => {
  it("puts Omanis into the SPF, and charges work injury for expats", () => {
    const o = slip("OM", { annual: 12000, profile: { nationality: "OM" } });
    expect(lines(o.deductions)).toEqual([["pension", 70], ["job_security", 10]]);
    expect(lines(o.employer)).toEqual([["pension_er", 115], ["injury_er", 10], ["job_security_er", 10]]);
    const x = slip("OM", { annual: 12000, profile: { nationality: "IN" } });
    expect(x.deductions).toEqual([]);
    expect(lines(x.employer)).toEqual([["injury_er", 10]]);
  });
  it("pays expats a month's basic a year after the first year; Omanis get theirs from the SPF", () => {
    expect(omanGratuity(500, 2 * 365)!.amount).toBe(1000);
    expect(omanGratuity(500, 200)).toBeNull();
    expect(packFor("OM").settlement({ ...exit, profile: { nationality: "OM" } }).gratuityEligible).toBe(false);
  });
});

describe("Bahrain", () => {
  it("puts Bahrainis into the SIO, and pays expats' leaving indemnity monthly", () => {
    const b = slip("BH", { annual: 12000, profile: { nationality: "BH" } });
    expect(lines(b.deductions)).toEqual([["pension", 60], ["unemployment", 10]]);
    expect(lines(b.employer)).toEqual([["pension_er", 120], ["injury_er", 30], ["unemployment_er", 10]]);
    const newer = slip("BH", { annual: 12000, profile: { nationality: "IN", joinedOn: "2025-01-01" } });
    expect(lines(newer.deductions)).toEqual([["unemployment", 10]]);
    expect(lines(newer.employer)).toEqual([["injury_er", 30], ["unemployment_er", 10], ["indemnity_er", 42]]);
    expect(slip("BH", { annual: 12000, profile: { nationality: "IN", joinedOn: "2020-01-01" } }).employer.at(-1)).toMatchObject({ amount: 84, label: "Leaving indemnity to SIO (8.4%)" });
  });
  it("pays the employer's share only for service before March 2024", () => {
    expect(bahrainIndemnity(1000, "2020-03-01", "2026-10-31")!.amount).toBeCloseTo(1500 + (1461 / 365 - 3) * 1000, 3);
    expect(bahrainIndemnity(1000, "2024-05-01", "2026-10-31")).toBeNull();
    expect(packFor("BH").settlement({ ...exit, dateOfJoining: "2020-03-01", profile: { nationality: "BH" } }).gratuityEligible).toBe(false);
  });
});
