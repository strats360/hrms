import { daysBetweenInclusive, type FnfInput, type FnfLine, type FnfResult } from "../../fnf";

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Final pay in the US: employment is at will, so there's no statutory severance or notice pay.
 * Unused vacation (PTO) is paid at the day rate (annual salary over 260) where state law or the
 * company's policy says so; California, Colorado and some others require it. Severance from an
 * agreement goes in as a manual line. Everything is wages, taxed through the final paycheck.
 */
export function usSettlement(i: FnfInput): FnfResult {
  const total = daysBetweenInclusive(i.dateOfJoining, i.lastWorkingDay);
  const days = Math.max(0, total - (i.unpaidLeaveDays ?? 0));
  const service = { days, years: Math.round((days / 365) * 100) / 100, completedYears: Math.floor(days / 365) };
  const lines: FnfLine[] = [];
  const dayRate = (i.monthlyGross * 12) / 260;
  for (const l of i.leave) {
    if (l.days <= 0) continue;
    lines.push({ key: `encash:${l.leaveTypeId}`, label: `Unused ${l.name.toLowerCase()}`, kind: "earning", amount: cents(dayRate * l.days), note: `${l.days} day${l.days === 1 ? "" : "s"} × salary / 260` });
  }
  i.manual.forEach((m, n) => {
    if (m.amount > 0) lines.push({ key: `manual:${n}`, label: m.label, kind: m.kind, amount: cents(m.amount) });
  });
  for (const rec of i.recoveries ?? []) if (rec.amount > 0) lines.push({ key: rec.key, label: rec.label, kind: "deduction", amount: cents(rec.amount) });
  const earnings = cents(lines.filter((l) => l.kind === "earning").reduce((s, l) => s + l.amount, 0));
  const deductions = cents(lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.amount, 0));
  return { lines, earnings, deductions, net: cents(earnings - deductions), taxable: earnings, service, notice: { required: 0, served: 0, shortfall: 0 }, gratuityEligible: false };
}
