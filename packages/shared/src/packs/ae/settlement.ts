import { daysBetweenInclusive, type FnfInput, type FnfLine, type FnfResult } from "../../fnf";
import { GRATUITY } from "./rules";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * End of service gratuity under Federal Decree-Law No. 33 of 2021, Article 51:
 * nothing before a year of continuous service; then 21 days' basic wage for each of the first five
 * years and 30 days' for each year after, with part years pro rata; never more than two years'
 * basic wage. The daily wage is the monthly basic over 30. Unpaid leave doesn't count as service.
 */
export function uaeGratuity(monthlyBasic: number, serviceDays: number) {
  if (serviceDays < GRATUITY.minServiceDays) return { amount: 0, years: serviceDays / 365, capped: false };
  const years = serviceDays / 365;
  const daily = monthlyBasic / GRATUITY.dayDivisor;
  const first = Math.min(years, 5) * GRATUITY.daysPerYearFirstFive * daily;
  const after = Math.max(0, years - 5) * GRATUITY.daysPerYearAfter * daily;
  const cap = GRATUITY.capMonths * monthlyBasic;
  return { amount: r2(Math.min(cap, first + after)), years, capped: first + after > cap };
}

/**
 * Final settlement in the UAE: gratuity (none for nationals in a pension scheme, whose end of
 * service benefits come from GPSSA or ADPF), unused annual leave on basic wage, notice pay or
 * recovery on full wage, and anything the employee still owes. There's no income tax.
 */
export function uaeSettlement(i: FnfInput): FnfResult {
  const total = daysBetweenInclusive(i.dateOfJoining, i.lastWorkingDay);
  const days = Math.max(0, total - (i.unpaidLeaveDays ?? 0));
  const service = { days, years: Math.round((days / 365) * 100) / 100, completedYears: Math.floor(days / 365) };
  const lines: FnfLine[] = [];

  for (const l of i.leave) {
    if (l.days <= 0) continue;
    lines.push({ key: `encash:${l.leaveTypeId}`, label: `${l.name} encashment`, kind: "earning", amount: r2((i.monthlyBasic / 30) * l.days), note: `${l.days} day${l.days === 1 ? "" : "s"} × basic / 30` });
  }

  const national = i.profile?.nationality === "AE";
  const g = uaeGratuity(i.monthlyBasic, days);
  const gratuityEligible = !national && g.amount > 0 && i.type !== "absconding";
  if (gratuityEligible) {
    const firstYears = Math.min(g.years, 5);
    const note = `21 days × ${firstYears.toFixed(2)} years${g.years > 5 ? ` + 30 days × ${(g.years - 5).toFixed(2)} years` : ""} of basic / 30${g.capped ? ", capped at two years' basic" : ""}`;
    lines.push({ key: "gratuity", label: "End of service gratuity", kind: "earning", amount: g.amount, note });
  }

  const served = i.type === "death" ? i.noticeDays : Math.min(i.noticeDays, daysBetweenInclusive(i.resignationDate, i.lastWorkingDay));
  const shortfall = Math.max(0, i.noticeDays - served);
  const perDay = i.monthlyGross / 30;
  if (shortfall > 0 && !i.noticeWaived) {
    // either side ending the contract without the notice owes the wage for the days not given
    if (i.type === "termination" && i.payInLieu) lines.push({ key: "notice_pay", label: "Notice pay in lieu", kind: "earning", amount: r2(perDay * shortfall), note: `${shortfall} day${shortfall === 1 ? "" : "s"} × wage / 30` });
    else if (i.type === "resignation" || i.type === "absconding") lines.push({ key: "notice_recovery", label: "Notice shortfall", kind: "deduction", amount: r2(perDay * shortfall), note: `${shortfall} day${shortfall === 1 ? "" : "s"} × wage / 30` });
  }

  i.manual.forEach((m, n) => {
    if (m.amount > 0) lines.push({ key: `manual:${n}`, label: m.label, kind: m.kind, amount: r2(m.amount) });
  });
  for (const rec of i.recoveries ?? []) if (rec.amount > 0) lines.push({ key: rec.key, label: rec.label, kind: "deduction", amount: r2(rec.amount) });

  const earnings = r2(lines.filter((l) => l.kind === "earning").reduce((s, l) => s + l.amount, 0));
  const deductions = r2(lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.amount, 0));
  return { lines, earnings, deductions, net: r2(earnings - deductions), taxable: 0, service, notice: { required: i.noticeDays, served, shortfall }, gratuityEligible };
}
