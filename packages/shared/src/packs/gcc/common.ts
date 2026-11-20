import { daysBetweenInclusive, type FnfInput, type FnfLine, type FnfResult } from "../../fnf";
import type { PayLine } from "../../payroll";
import { roundMoney } from "../../format";
import type { StatutoryContext, StatutoryResult } from "../types";

/**
 * Shared shape of the Qatar, Kuwait, Oman and Bahrain packs: no income tax, social insurance
 * for nationals (and a little for everyone else), an end of service award, and other GCC
 * nationals on their home scheme. Each country fills in the rates.
 */
export const GCC = ["AE", "SA", "QA", "KW", "OM", "BH"];

export interface Contribution {
  code: string;
  label: string;
  rate: number;
}

export interface SocialInsurance {
  /** The country whose nationals the scheme covers in full. */
  country: string;
  currency: string;
  /** Which pay the contributions are on. */
  base: "basic_housing" | "gross";
  /** Monthly limits on the contribution wage. */
  min: number;
  max: number;
  nationals: { employee: Contribution[]; employer: Contribution[] };
  /** Everyone else who isn't a GCC national. */
  others: { employee: Contribution[]; employer: Contribution[] };
  /** Lines that depend on more than the wage (Bahrain's leaving indemnity for expats). */
  extra?: (ctx: StatutoryContext, base: number) => { employee: PayLine[]; employer: PayLine[] };
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

export function gccStatutory(s: SocialInsurance, ctx: StatutoryContext): StatutoryResult {
  const { input, round: r } = ctx;
  const warnings: string[] = [];
  const nationality = input.profile?.nationality ?? null;
  const c = input.structure.components;
  const wage = s.base === "gross" ? input.structure.gross : (c.basic ?? 0) + (c.hra ?? 0);
  const base = Math.min(s.max, Math.max(s.min, wage)) * ctx.factor;
  if (wage > s.max) warnings.push(`Social insurance wage capped at ${s.currency} ${s.max.toLocaleString("en-US")}`);

  const set = nationality === s.country ? s.nationals : nationality && GCC.includes(nationality) ? null : s.others;
  if (!nationality) warnings.push(`Nationality isn't set: if this person is a national, social insurance is missing`);
  if (!set) warnings.push("GCC national: pension contributions follow their home country's scheme. Add them as a deduction until that scheme is supported");
  const line = (x: Contribution, who: string) => ({ code: x.code, label: `${x.label} (${who}${pct(x.rate)})`, amount: r(base * x.rate) });
  const deductions: PayLine[] = (set?.employee ?? []).map((x) => line(x, ""));
  const employer: PayLine[] = (set?.employer ?? []).map((x) => line(x, "employer "));
  if (s.extra && set === s.others) {
    const more = s.extra(ctx, base);
    deductions.push(...more.employee);
    employer.push(...more.employer);
  }
  return {
    deductions,
    employer,
    tds: 0,
    tax: { taxableIncome: 0, baseTax: 0, rebate: 0, surcharge: 0, cess: 0, total: 0, projectedAnnualGross: input.structure.gross * 12, monthsLeft: 12, annualised: true },
    warnings,
  };
}

export interface Award {
  amount: number;
  note: string;
}

export interface SettlementRules {
  /** Nationals in the social insurance scheme get their end of service benefit from it, not the employer. */
  nationalsCovered: string | null;
  /** The award before any cut, or null when there's none. */
  award(i: FnfInput, serviceDays: number): Award | null;
  /** The share of the award paid on resignation, by years of service. */
  resignationShare?: (years: number) => number;
  /** Unused leave is paid on basic or on the full wage. */
  leaveOn: "basic" | "gross";
  decimals: number;
}

/** Final settlement: award, leave encashment, notice, manual lines and recoveries. No income tax. */
export function gccSettlement(i: FnfInput, s: SettlementRules): FnfResult {
  const r = (n: number) => roundMoney(n, s.decimals);
  const total = daysBetweenInclusive(i.dateOfJoining, i.lastWorkingDay);
  const days = Math.max(0, total - (i.unpaidLeaveDays ?? 0));
  const service = { days, years: Math.round((days / 365) * 100) / 100, completedYears: Math.floor(days / 365) };
  const lines: FnfLine[] = [];

  const leaveWage = (s.leaveOn === "basic" ? i.monthlyBasic : i.monthlyGross) / 30;
  for (const l of i.leave) {
    if (l.days <= 0) continue;
    lines.push({ key: `encash:${l.leaveTypeId}`, label: `${l.name} encashment`, kind: "earning", amount: r(leaveWage * l.days), note: `${l.days} day${l.days === 1 ? "" : "s"} × ${s.leaveOn === "basic" ? "basic" : "wage"} / 30` });
  }

  const covered = !!s.nationalsCovered && i.profile?.nationality === s.nationalsCovered;
  const award = covered || i.type === "absconding" ? null : s.award(i, days);
  const share = i.type === "resignation" && s.resignationShare ? s.resignationShare(days / 365) : 1;
  const gratuityEligible = !!award && award.amount > 0 && share > 0;
  if (gratuityEligible) {
    const cut = share < 1 ? `, ${share === 0.5 ? "half" : share === 1 / 3 ? "a third" : "two thirds"} on resignation` : "";
    lines.push({ key: "gratuity", label: "End of service award", kind: "earning", amount: r(award.amount * share), note: award.note + cut });
  }

  const served = i.type === "death" ? i.noticeDays : Math.min(i.noticeDays, daysBetweenInclusive(i.resignationDate, i.lastWorkingDay));
  const shortfall = Math.max(0, i.noticeDays - served);
  const perDay = i.monthlyGross / 30;
  if (shortfall > 0 && !i.noticeWaived) {
    if (i.type === "termination" && i.payInLieu) lines.push({ key: "notice_pay", label: "Notice pay in lieu", kind: "earning", amount: r(perDay * shortfall), note: `${shortfall} day${shortfall === 1 ? "" : "s"} × wage / 30` });
    else if (i.type === "resignation" || i.type === "absconding") lines.push({ key: "notice_recovery", label: "Notice shortfall", kind: "deduction", amount: r(perDay * shortfall), note: `${shortfall} day${shortfall === 1 ? "" : "s"} × wage / 30` });
  }

  i.manual.forEach((m, n) => {
    if (m.amount > 0) lines.push({ key: `manual:${n}`, label: m.label, kind: m.kind, amount: r(m.amount) });
  });
  for (const rec of i.recoveries ?? []) if (rec.amount > 0) lines.push({ key: rec.key, label: rec.label, kind: "deduction", amount: r(rec.amount) });

  const earnings = r(lines.filter((l) => l.kind === "earning").reduce((sum, l) => sum + l.amount, 0));
  const deductions = r(lines.filter((l) => l.kind === "deduction").reduce((sum, l) => sum + l.amount, 0));
  return { lines, earnings, deductions, net: r(earnings - deductions), taxable: 0, service, notice: { required: i.noticeDays, served, shortfall }, gratuityEligible };
}

export const yearsNote = (years: number) => `${years.toFixed(2)} years`;

/** Payslip net pay in words: the currency code and the amount with its minor units. */
export const amountWords = (currency: string, decimals: number) => (n: number) =>
  `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

export const GULF_LABELS = { hra: "Housing allowance", conveyance: "Transport allowance", medical: "Medical allowance", special: "Other allowance" } as const;
