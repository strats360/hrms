import type { PayLine } from "../../payroll";
import type { StatutoryContext, StatutoryResult } from "../types";
import { caPayrollProfileSchema, type CaPayrollProfile } from "./profile";
import { CPP, EI, FEDERAL, ONTARIO, PROVINCES, provinceCode, QPIP, QPP, TAX_YEAR, type Bracket } from "./rules";

const cents = (n: number) => Math.round(n * 100) / 100;

function bracketTax(income: number, brackets: Bracket[]) {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    if (income > lower) tax += (Math.min(income, b.upTo) - lower) * b.rate;
    lower = b.upTo;
  }
  return tax;
}

/** The federal basic personal amount for a net income: full, then reduced between the 4th and 5th thresholds. */
export function federalBpa(income: number) {
  const lo = FEDERAL.brackets[2]!.upTo;
  const hi = FEDERAL.brackets[3]!.upTo;
  if (income <= lo) return FEDERAL.bpaMax;
  if (income >= hi) return FEDERAL.bpaMin;
  return FEDERAL.bpaMax - ((FEDERAL.bpaMax - FEDERAL.bpaMin) * (income - lo)) / (hi - lo);
}

/** Ontario health premium on annual taxable income. */
export function ontarioHealthPremium(a: number) {
  const step = (from: number, base: number, rate: number, cap: number) => Math.min(cap, base + (a - from) * rate);
  if (a <= 20000) return 0;
  if (a <= 36000) return step(20000, 0, 0.06, 300);
  if (a <= 48000) return step(36000, 300, 0.06, 450);
  if (a <= 72000) return step(48000, 450, 0.25, 600);
  if (a <= 200000) return step(72000, 600, 0.25, 750);
  return step(200000, 750, 0.25, 900);
}

/** CPP (or QPP) this month: base plus enhanced on pay over the monthly exemption, up to the year's maximum; CPP2 between the YMPE and the YAMPE. */
export function pensionThisMonth(o: { pay: number; ytdPay: number; monthsBefore: number; quebec: boolean; periods?: number }) {
  const P = o.periods ?? 12;
  const plan = o.quebec ? QPP : CPP;
  const max = (plan.ympe - plan.exemption) * plan.rate;
  const per = plan.exemption / P;
  const paidBefore = Math.min(max, Math.max(0, (Math.min(o.ytdPay, plan.ympe) - per * o.monthsBefore) * plan.rate));
  const cpp = Math.max(0, Math.min(Math.max(0, o.pay - per) * plan.rate, max - paidBefore));
  const cpp2 = Math.max(0, Math.min(o.ytdPay + o.pay, plan.yampe) - Math.max(o.ytdPay, plan.ympe)) * plan.rate2;
  return { cpp: cents(cpp), cpp2: cents(cpp2), base: cents((cpp * plan.baseRate) / plan.rate), enhanced: cents((cpp * (plan.rate - plan.baseRate)) / plan.rate) };
}

export function eiThisMonth(o: { pay: number; ytdPay: number; quebec: boolean }) {
  const rate = o.quebec ? EI.quebecRate : EI.rate;
  const insurable = Math.max(0, Math.min(o.ytdPay + o.pay, EI.maxInsurable) - o.ytdPay);
  return cents(insurable * rate);
}

/**
 * Income tax for one pay, the T4127 way: annualise taxable pay (less the enhanced CPP
 * and CPP2, which are deductions), apply the brackets, take off credits at the lowest rate for
 * the TD1 claim, CPP base, EI and the Canada employment amount, then spread over the year.
 */
export function incomeTaxThisMonth(o: { taxablePay: number; cpp: { base: number; enhanced: number; cpp2: number }; ei: number; profile: CaPayrollProfile; province: string | null; periods?: number }) {
  const P = o.periods ?? 12;
  const a = Math.max(0, (o.taxablePay - o.cpp.enhanced - o.cpp.cpp2) * P);
  const quebec = o.province === "QC";
  const cppCredit = Math.min(o.cpp.base * P, (CPP.ympe - CPP.exemption) * CPP.baseRate);
  const eiCredit = Math.min(o.ei * P, EI.maxInsurable * (quebec ? EI.quebecRate : EI.rate));
  const fedClaim = o.profile.federalClaim ?? federalBpa(a);
  let federal = bracketTax(a, FEDERAL.brackets) - FEDERAL.creditRate * (fedClaim + cppCredit + eiCredit + Math.min(a, FEDERAL.employmentAmount));
  federal = Math.max(0, federal);
  if (quebec) federal *= 1 - FEDERAL.quebecAbatement;

  let provincial: number | null = null;
  if (o.province === "ON") {
    const basic = Math.max(0, bracketTax(a, ONTARIO.brackets) - ONTARIO.creditRate * ((o.profile.provincialClaim ?? ONTARIO.bpa) + cppCredit + eiCredit));
    const surtax = ONTARIO.surtax.reduce((s, t) => s + Math.max(0, basic - t.over) * t.rate, 0);
    provincial = basic + surtax + ontarioHealthPremium(a);
  }
  return { federal: cents(federal / P), provincial: provincial === null ? null : cents(provincial / P), annualTaxable: a };
}

/** Canada: federal and Ontario income tax, CPP or QPP with CPP2, EI, and QPIP in Quebec. */
export function canadaStatutory(ctx: StatutoryContext): StatutoryResult {
  const { input } = ctx;
  const warnings: string[] = [];
  const parsed = caPayrollProfileSchema.safeParse(input.countryProfile ?? {});
  if (!parsed.success) warnings.push(`TD1 details aren't valid (${parsed.error.issues[0]?.message}): using the basic personal amounts`);
  const profile = parsed.success ? parsed.data : caPayrollProfileSchema.parse({});
  if (Number(input.month.slice(0, 4)) !== TAX_YEAR) warnings.push(`These rates are for ${TAX_YEAR}, not ${input.month.slice(0, 4)}`);

  const province = provinceCode(input.state);
  const quebec = province === "QC";
  const gross = ctx.gross;
  const taxablePay = gross - ctx.nonTaxableEarnings;
  const ytdPay = input.ytd?.taxableGross ?? 0;
  const P = ctx.periodsPerYear;
  // the exemption is spread over the year's pay periods; count the ones already paid
  const monthsBefore = ctx.periodIndex - 1;

  const pension = profile.cppExempt ? { cpp: 0, cpp2: 0, base: 0, enhanced: 0 } : pensionThisMonth({ pay: gross, ytdPay, monthsBefore, quebec, periods: P });
  const ei = profile.eiExempt ? 0 : eiThisMonth({ pay: gross, ytdPay, quebec });
  const qpip = quebec ? cents(Math.max(0, Math.min(ytdPay + gross, QPIP.maxInsurable) - ytdPay) * QPIP.rate) : 0;
  const qpipEr = quebec ? cents(Math.max(0, Math.min(ytdPay + gross, QPIP.maxInsurable) - ytdPay) * QPIP.employerRate) : 0;
  const tax = incomeTaxThisMonth({ taxablePay, cpp: { base: pension.base, enhanced: pension.enhanced, cpp2: pension.cpp2 }, ei, profile, province, periods: P });

  const plan = quebec ? "QPP" : "CPP";
  const deductions: PayLine[] = [
    { code: "fed_tax", label: "Federal income tax", amount: cents(tax.federal + profile.extraTax) },
    ...(tax.provincial !== null ? [{ code: "prov_tax", label: `${PROVINCES[province!]} income tax`, amount: tax.provincial }] : []),
    { code: "cpp", label: plan, amount: pension.cpp },
    { code: "cpp2", label: `${plan}2`, amount: pension.cpp2 },
    { code: "ei", label: "Employment Insurance", amount: ei },
    { code: "qpip", label: "QPIP", amount: qpip },
  ];
  const employer: PayLine[] = [
    { code: "cpp_er", label: `${plan} (employer)`, amount: pension.cpp },
    { code: "cpp2_er", label: `${plan}2 (employer)`, amount: pension.cpp2 },
    { code: "ei_er", label: "EI (employer, 1.4×)", amount: cents(ei * EI.employerFactor) },
    { code: "qpip_er", label: "QPIP (employer)", amount: qpipEr },
  ];

  if (!province) warnings.push("No province of employment set: only federal tax, CPP and EI are worked out");
  else if (quebec) warnings.push("Quebec income tax isn't worked out here yet: get it from your payroll partner and add it as a deduction");
  else if (province !== "ON") warnings.push(`${PROVINCES[province]} income tax isn't worked out here yet: get it from your payroll partner and add it as a deduction`);
  if (!input.countryProfile) warnings.push("No TD1 on file: using the basic personal amounts");

  const fedProv = tax.federal + profile.extraTax + (tax.provincial ?? 0);
  return {
    deductions,
    employer,
    tds: cents(fedProv),
    tax: { taxableIncome: tax.annualTaxable, baseTax: fedProv * P, rebate: 0, surcharge: 0, cess: 0, total: fedProv * P, projectedAnnualGross: input.structure.gross * 12, monthsLeft: 12 - Number(input.month.slice(5, 7)), annualised: true },
    warnings,
  };
}
