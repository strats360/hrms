import { daysBetweenInclusive, type FnfInput, type FnfLine, type FnfResult } from "../../fnf";

const cents = (n: number) => Math.round(n * 100) / 100;

/** Ontario ESA termination pay: one week per completed year of service (at least one after three months), up to eight weeks. */
export function ontarioNoticeWeeks(serviceDays: number) {
  if (serviceDays < 90) return 0;
  return Math.min(8, Math.max(1, Math.floor(serviceDays / 365)));
}

/**
 * Final pay in Canada: unused vacation at the day rate (annual salary over 260), and termination
 * pay in lieu of notice when the employer ends the job without working notice, at the Ontario
 * Employment Standards Act minimum. Other provinces, ESA severance pay (5+ years and a $2.5M
 * payroll) and common law notice go in as manual lines. Everything is taxed through the last pay,
 * and a Record of Employment (ROE) must be filed with Service Canada.
 */
export function canadaSettlement(i: FnfInput): FnfResult {
  const total = daysBetweenInclusive(i.dateOfJoining, i.lastWorkingDay);
  const days = Math.max(0, total - (i.unpaidLeaveDays ?? 0));
  const service = { days, years: Math.round((days / 365) * 100) / 100, completedYears: Math.floor(days / 365) };
  const lines: FnfLine[] = [];
  const dayRate = (i.monthlyGross * 12) / 260;
  for (const l of i.leave) {
    if (l.days <= 0) continue;
    lines.push({ key: `encash:${l.leaveTypeId}`, label: `Unused ${l.name.toLowerCase()}`, kind: "earning", amount: cents(dayRate * l.days), note: `${l.days} day${l.days === 1 ? "" : "s"} × salary / 260` });
  }
  const weeks = i.type === "termination" ? ontarioNoticeWeeks(total) : 0;
  const required = weeks * 7;
  const served = i.type === "termination" ? Math.min(required, daysBetweenInclusive(i.resignationDate, i.lastWorkingDay)) : 0;
  const shortfall = Math.max(0, required - served);
  if (i.type === "termination" && shortfall > 0 && !i.noticeWaived) {
    const weekly = (i.monthlyGross * 12) / 52;
    lines.push({ key: "notice_pay", label: "Termination pay in lieu of notice", kind: "earning", amount: cents((weekly * shortfall) / 7), note: `${shortfall} days of the ${weeks} week${weeks === 1 ? "" : "s"} Ontario ESA minimum × weekly wage` });
  }
  i.manual.forEach((m, n) => {
    if (m.amount > 0) lines.push({ key: `manual:${n}`, label: m.label, kind: m.kind, amount: cents(m.amount) });
  });
  for (const rec of i.recoveries ?? []) if (rec.amount > 0) lines.push({ key: rec.key, label: rec.label, kind: "deduction", amount: cents(rec.amount) });
  const earnings = cents(lines.filter((l) => l.kind === "earning").reduce((s, l) => s + l.amount, 0));
  const deductions = cents(lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.amount, 0));
  return { lines, earnings, deductions, net: cents(earnings - deductions), taxable: earnings, service, notice: { required, served, shortfall }, gratuityEligible: false };
}
