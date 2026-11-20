import { daysBetweenInclusive, type FnfInput, type FnfLine, type FnfResult } from "../../fnf";
import { EOSB } from "./rules";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * End of service award under the Saudi Labor Law, Article 84: half a month's wage for each of the
 * first five years and a full month's for each year after, part years pro rata, on the last wage.
 * There's no minimum service and no cap.
 */
export function saudiEndOfService(monthlyWage: number, serviceDays: number) {
  const years = serviceDays / 365;
  const amount = Math.min(years, 5) * EOSB.monthsPerYearFirstFive * monthlyWage + Math.max(0, years - 5) * EOSB.monthsPerYearAfter * monthlyWage;
  return { amount: r2(amount), years };
}

/** The share of the award paid on resignation (Article 85). */
export function resignationShare(years: number): number {
  return EOSB.resignationShare.find((s) => years >= s.minYears)!.share;
}

/**
 * Final settlement in Saudi Arabia: the end of service award (reduced on resignation, nothing for
 * someone who absconds), unused annual leave and notice on the full wage, and anything the
 * employee still owes. Article 87 cases that get the full award on resignation (force majeure, a
 * woman leaving within six months of marriage or three of giving birth) are entered by HR as a
 * manual line. There's no income tax.
 */
export function saudiSettlement(i: FnfInput): FnfResult {
  const total = daysBetweenInclusive(i.dateOfJoining, i.lastWorkingDay);
  const days = Math.max(0, total - (i.unpaidLeaveDays ?? 0));
  const service = { days, years: Math.round((days / 365) * 100) / 100, completedYears: Math.floor(days / 365) };
  const lines: FnfLine[] = [];
  const perDay = i.monthlyGross / 30;

  for (const l of i.leave) {
    if (l.days <= 0) continue;
    lines.push({ key: `encash:${l.leaveTypeId}`, label: `${l.name} encashment`, kind: "earning", amount: r2(perDay * l.days), note: `${l.days} day${l.days === 1 ? "" : "s"} × wage / 30` });
  }

  const award = saudiEndOfService(i.monthlyGross, days);
  const share = i.type === "absconding" ? 0 : i.type === "resignation" ? resignationShare(award.years) : 1;
  const gratuityEligible = share > 0 && award.amount > 0;
  if (gratuityEligible) {
    const firstYears = Math.min(award.years, 5);
    const parts = `half a month × ${firstYears.toFixed(2)} years${award.years > 5 ? ` + a month × ${(award.years - 5).toFixed(2)} years` : ""} of wage`;
    const cut = share < 1 ? `, ${share === 1 / 3 ? "a third" : "two thirds"} on resignation` : "";
    lines.push({ key: "gratuity", label: "End of service award", kind: "earning", amount: r2(award.amount * share), note: parts + cut });
  }

  const served = i.type === "death" ? i.noticeDays : Math.min(i.noticeDays, daysBetweenInclusive(i.resignationDate, i.lastWorkingDay));
  const shortfall = Math.max(0, i.noticeDays - served);
  if (shortfall > 0 && !i.noticeWaived) {
    // Article 76: the side that doesn't give the notice owes the wage for the days not given
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
