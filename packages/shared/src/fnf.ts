/**
 * Full and final settlement: the dues and recoveries on an employee's exit, on top of
 * the last month's salary (which the regular payroll run pays, prorated to the last
 * working day).
 *
 * - Gratuity (Payment of Gratuity Act): after 4 years 240 days of continuous service,
 *   or on death or disablement at any length of service. 15/26 x last monthly basic x
 *   completed years, where a part year of more than 6 months counts as a full year.
 *   Capped at ₹20 lakh, which is also the income-tax exemption.
 * - Leave encashment: encashable leave days x basic / 26. Exempt up to ₹25 lakh for
 *   non-government employees (section 10(10AA)).
 * - Notice: calendar days between resignation and last working day count as served.
 *   On a resignation the shortfall is recovered at gross / 30 a day, unless waived.
 *   On a termination the employer can pay the shortfall in lieu of notice.
 */
export const EXIT_TYPES = ["resignation", "termination", "retirement", "contract_end", "death", "absconding"] as const;
export type ExitType = (typeof EXIT_TYPES)[number];
export const EXIT_TYPE_LABELS: Record<ExitType, string> = {
  resignation: "Resignation",
  termination: "Termination",
  retirement: "Retirement",
  contract_end: "End of contract",
  death: "Death",
  absconding: "Absconding",
};

export const EXIT_STATUSES = ["requested", "notice", "settlement", "approved", "settled", "cancelled"] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];
export const EXIT_STATUS_LABELS: Record<ExitStatus, string> = {
  requested: "Resignation requested",
  notice: "Serving notice",
  settlement: "Settlement drafted",
  approved: "Settlement approved",
  settled: "Settled",
  cancelled: "Withdrawn",
};

export const DEFAULT_CLEARANCE = [
  { key: "assets", label: "Laptop, ID card and other company assets returned" },
  { key: "handover", label: "Work and documents handed over" },
  { key: "access", label: "Email and system access removed" },
  { key: "finance", label: "No dues from finance (advances, loans, card)" },
] as const;

export const GRATUITY_CAP = 2_000_000;
export const ENCASHMENT_EXEMPTION = 2_500_000;
/** 4 years and 240 days. */
export const GRATUITY_MIN_DAYS = 4 * 365 + 240;

export interface ManualLine {
  label: string;
  kind: "earning" | "deduction";
  amount: number;
  /** Taxable earnings go into the taxable total shown for TDS. */
  taxable?: boolean;
}

export interface EncashableLeave {
  leaveTypeId: string;
  name: string;
  days: number;
}

export interface FnfInput {
  type: ExitType;
  dateOfJoining: string;
  resignationDate: string;
  lastWorkingDay: string;
  monthlyBasic: number;
  monthlyGross: number;
  noticeDays: number;
  noticeWaived: boolean;
  /** Termination: pay the notice shortfall instead of asking the employee to serve it. */
  payInLieu: boolean;
  leave: EncashableLeave[];
  manual: ManualLine[];
  tds: number;
}

export interface FnfLine {
  key: string;
  label: string;
  kind: "earning" | "deduction";
  amount: number;
  note?: string;
}

export interface FnfResult {
  lines: FnfLine[];
  earnings: number;
  deductions: number;
  /** Positive: the company pays the employee. Negative: the employee owes the company. */
  net: number;
  /** Earnings after exemptions, for the TDS computation. */
  taxable: number;
  service: { days: number; years: number; completedYears: number };
  notice: { required: number; served: number; shortfall: number };
  gratuityEligible: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayMs = 86400000;

export function daysBetweenInclusive(from: string, to: string) {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1);
}

/** Length of service, with a part year of more than 6 months rounded up. */
export function serviceLength(doj: string, lwd: string) {
  const days = daysBetweenInclusive(doj, lwd);
  const years = days / 365.25;
  const whole = Math.floor(years);
  return { days, years: Math.round(years * 100) / 100, completedYears: whole + (years - whole > 0.5 ? 1 : 0) };
}

export function computeSettlement(i: FnfInput): FnfResult {
  const service = serviceLength(i.dateOfJoining, i.lastWorkingDay);
  const lines: FnfLine[] = [];
  let taxable = 0;

  // leave encashment
  for (const l of i.leave) {
    if (l.days <= 0) continue;
    const amount = r2((i.monthlyBasic / 26) * l.days);
    lines.push({ key: `encash:${l.leaveTypeId}`, label: `${l.name} encashment`, kind: "earning", amount, note: `${l.days} day${l.days === 1 ? "" : "s"} × basic / 26` });
  }
  const encashment = lines.reduce((s, l) => s + l.amount, 0);
  taxable += Math.max(0, encashment - ENCASHMENT_EXEMPTION);

  // gratuity
  const gratuityEligible = i.type === "death" || service.days >= GRATUITY_MIN_DAYS;
  if (gratuityEligible && i.type !== "absconding") {
    const years = Math.max(1, service.completedYears);
    const raw = (15 / 26) * i.monthlyBasic * years;
    const amount = r2(Math.min(GRATUITY_CAP, raw));
    if (amount > 0) lines.push({ key: "gratuity", label: "Gratuity", kind: "earning", amount, note: `15/26 × basic × ${years} year${years === 1 ? "" : "s"}${raw > GRATUITY_CAP ? " (capped at ₹20 lakh)" : ""}` });
  }

  // notice
  const served = i.type === "death" ? i.noticeDays : Math.min(i.noticeDays, daysBetweenInclusive(i.resignationDate, i.lastWorkingDay));
  const shortfall = Math.max(0, i.noticeDays - served);
  const perDay = i.monthlyGross / 30;
  if (shortfall > 0 && !i.noticeWaived) {
    if (i.type === "termination" && i.payInLieu) {
      const amount = r2(perDay * shortfall);
      lines.push({ key: "notice_pay", label: "Notice pay in lieu", kind: "earning", amount, note: `${shortfall} day${shortfall === 1 ? "" : "s"} × gross / 30` });
      taxable += amount;
    } else if (i.type === "resignation" || i.type === "absconding") {
      lines.push({ key: "notice_recovery", label: "Notice shortfall recovery", kind: "deduction", amount: r2(perDay * shortfall), note: `${shortfall} day${shortfall === 1 ? "" : "s"} × gross / 30` });
    }
  }

  // manual lines
  i.manual.forEach((m, n) => {
    if (!(m.amount > 0)) return;
    lines.push({ key: `manual:${n}`, label: m.label, kind: m.kind, amount: r2(m.amount) });
    if (m.kind === "earning" && m.taxable !== false) taxable += m.amount;
  });

  if (i.tds > 0) lines.push({ key: "tds", label: "TDS on settlement", kind: "deduction", amount: r2(i.tds) });

  const earnings = r2(lines.filter((l) => l.kind === "earning").reduce((s, l) => s + l.amount, 0));
  const deductions = r2(lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.amount, 0));
  return { lines, earnings, deductions, net: r2(earnings - deductions), taxable: r2(taxable), service, notice: { required: i.noticeDays, served, shortfall }, gratuityEligible };
}

/** Default notice period: shorter while on probation. */
export function defaultNoticeDays(status: string, s: { noticeDays?: number; probationNoticeDays?: number }) {
  return status === "probation" ? (s.probationNoticeDays ?? 15) : (s.noticeDays ?? 30);
}
