import { daysBetweenInclusive, type FnfInput, type FnfLine, type FnfResult } from "../../fnf";

const pence = (n: number) => Math.round(n * 100) / 100;

/**
 * Final pay in the UK: there's no end of service gratuity. Unused holiday is paid at the day
 * rate (annual salary over 260 working days); notice not worked is paid in lieu on termination,
 * or recovered on resignation if the contract allows it. All of it is taxed through the last
 * payslip, so it's all taxable here. Statutory redundancy pay (and the first £30,000 being tax
 * free) and PILON's post employment notice pay rules are for HR to enter as manual lines.
 */
export function ukSettlement(i: FnfInput): FnfResult {
  const total = daysBetweenInclusive(i.dateOfJoining, i.lastWorkingDay);
  const days = Math.max(0, total - (i.unpaidLeaveDays ?? 0));
  const service = { days, years: Math.round((days / 365) * 100) / 100, completedYears: Math.floor(days / 365) };
  const lines: FnfLine[] = [];
  const dayRate = (i.monthlyGross * 12) / 260;

  for (const l of i.leave) {
    if (l.days <= 0) continue;
    lines.push({ key: `encash:${l.leaveTypeId}`, label: `Unused ${l.name.toLowerCase()}`, kind: "earning", amount: pence(dayRate * l.days), note: `${l.days} day${l.days === 1 ? "" : "s"} × salary / 260` });
  }

  const served = i.type === "death" ? i.noticeDays : Math.min(i.noticeDays, daysBetweenInclusive(i.resignationDate, i.lastWorkingDay));
  const shortfall = Math.max(0, i.noticeDays - served);
  const calDay = (i.monthlyGross * 12) / 365;
  if (shortfall > 0 && !i.noticeWaived) {
    if (i.type === "termination" && i.payInLieu) lines.push({ key: "notice_pay", label: "Pay in lieu of notice", kind: "earning", amount: pence(calDay * shortfall), note: `${shortfall} day${shortfall === 1 ? "" : "s"} × salary / 365` });
    else if (i.type === "resignation") lines.push({ key: "notice_recovery", label: "Notice not worked", kind: "deduction", amount: pence(calDay * shortfall), note: `${shortfall} day${shortfall === 1 ? "" : "s"} × salary / 365, if the contract allows it` });
  }

  i.manual.forEach((m, n) => {
    if (m.amount > 0) lines.push({ key: `manual:${n}`, label: m.label, kind: m.kind, amount: pence(m.amount) });
  });
  for (const rec of i.recoveries ?? []) if (rec.amount > 0) lines.push({ key: rec.key, label: rec.label, kind: "deduction", amount: pence(rec.amount) });

  const earnings = pence(lines.filter((l) => l.kind === "earning").reduce((s, l) => s + l.amount, 0));
  const deductions = pence(lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.amount, 0));
  return { lines, earnings, deductions, net: pence(earnings - deductions), taxable: earnings, service, notice: { required: i.noticeDays, served, shortfall }, gratuityEligible: false };
}
