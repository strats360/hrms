/**
 * Full and final settlement: the dues and recoveries on an employee's exit, on top of
 * the last month's salary (which the regular payroll run pays, prorated to the last
 * working day).
 *
 * - Gratuity (Code on Social Security 2020): after 5 years of continuous service, or on
 *   death or disablement at any length of service; fixed term employees get it pro rata
 *   after 1 year. 15/26 x last monthly Code wages x completed years, where a part year of
 *   more than 6 months counts as a full year. Capped at ₹20 lakh, which is also the
 *   income tax exemption. Due within 30 days.
 * - Leave encashment: encashable leave days x Code wages / 26. Exempt up to ₹25 lakh for
 *   non-government employees.
 * - Notice: calendar days between resignation and last working day count as served.
 *   On a resignation the shortfall is recovered at gross / 30 a day, unless waived.
 *   On a termination the employer can pay the shortfall in lieu of notice.
 */
export const EXIT_TYPES = ["resignation", "termination", "retrenchment", "retirement", "contract_end", "death", "absconding"] as const;
export type ExitType = (typeof EXIT_TYPES)[number];
export const EXIT_TYPE_LABELS: Record<ExitType, string> = {
  resignation: "Resignation",
  termination: "Termination",
  retrenchment: "Retrenchment",
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
/** Five years of continuous service (Code on Social Security, section 53). */
export const GRATUITY_MIN_DAYS = 5 * 365;
/** Fixed term employees qualify after a year, pro rata. */
export const GRATUITY_FIXED_TERM_MIN_DAYS = 365;

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
  /** India: monthly Code wages (basic plus wage allowances, at least half the gross); gratuity and encashment use it. */
  monthlyWages?: number;
  /** India: a fixed term employee, who gets gratuity pro rata after one year. */
  fixedTerm?: boolean;
  noticeDays: number;
  noticeWaived: boolean;
  /** Termination: pay the notice shortfall instead of asking the employee to serve it. */
  payInLieu: boolean;
  leave: EncashableLeave[];
  manual: ManualLine[];
  tds: number;
  /** Amounts the employee still owes the company (loans, advances), taken from the settlement. */
  recoveries?: { key: string; label: string; amount: number }[];
  /** Facts some country packs need, e.g. nationals in a Gulf pension scheme get no gratuity. */
  profile?: { nationality?: string | null; region?: string | null; insuredSince?: string | null; joinedOn?: string | null };
  /** Unpaid leave days, which some countries leave out of the service that counts. */
  unpaidLeaveDays?: number;
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
  /** What the employer owes elsewhere because of this exit, not paid to the employee (India: the re-skilling fund). */
  employerDues?: { label: string; amount: number; due: string }[];
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
  const wages = i.monthlyWages ?? i.monthlyBasic;
  const lines: FnfLine[] = [];
  let taxable = 0;

  // leave encashment
  for (const l of i.leave) {
    if (l.days <= 0) continue;
    const amount = r2((wages / 26) * l.days);
    lines.push({ key: `encash:${l.leaveTypeId}`, label: `${l.name} encashment`, kind: "earning", amount, note: `${l.days} day${l.days === 1 ? "" : "s"} × wages / 26` });
  }
  const encashment = lines.reduce((s, l) => s + l.amount, 0);
  taxable += Math.max(0, encashment - ENCASHMENT_EXEMPTION);

  // gratuity
  const gratuityEligible = i.type === "death" || service.days >= (i.fixedTerm ? GRATUITY_FIXED_TERM_MIN_DAYS : GRATUITY_MIN_DAYS);
  if (gratuityEligible && i.type !== "absconding") {
    // fixed term: pro rata for the exact service; otherwise completed years, a part year over 6 months counting as one
    const years = i.fixedTerm ? Math.round(service.years * 100) / 100 : Math.max(1, service.completedYears);
    const raw = (15 / 26) * wages * years;
    const amount = r2(Math.min(GRATUITY_CAP, raw));
    if (amount > 0) lines.push({ key: "gratuity", label: "Gratuity", kind: "earning", amount, note: `15/26 × wages × ${years} year${years === 1 ? "" : "s"}${i.fixedTerm ? " (fixed term, pro rata)" : ""}${raw > GRATUITY_CAP ? " (capped at ₹20 lakh)" : ""}` });
  }

  // retrenchment (Industrial Relations Code): 15 days' average pay for each completed year, for a
  // worker with a year or more of service, and 15 days' wages into the re-skilling fund within 10 days
  let employerDues: FnfResult["employerDues"];
  if (i.type === "retrenchment" && service.days >= 365) {
    const years = service.completedYears;
    const comp = r2((15 / 26) * wages * years);
    lines.push({ key: "retrenchment", label: "Retrenchment compensation", kind: "earning", amount: comp, note: `15/26 × wages × ${years} year${years === 1 ? "" : "s"}` });
    // tax free up to ₹5 lakh
    taxable += Math.max(0, comp - 500000);
    const due = new Date(Date.parse(`${i.lastWorkingDay}T00:00:00Z`) + 10 * 86400000).toISOString().slice(0, 10);
    employerDues = [{ label: "Worker re-skilling fund (15 days' wages)", amount: r2((15 / 26) * wages), due }];
  }

  // notice
  const served = i.type === "death" ? i.noticeDays : Math.min(i.noticeDays, daysBetweenInclusive(i.resignationDate, i.lastWorkingDay));
  const shortfall = Math.max(0, i.noticeDays - served);
  const perDay = i.monthlyGross / 30;
  if (shortfall > 0 && !i.noticeWaived) {
    if ((i.type === "termination" || i.type === "retrenchment") && i.payInLieu) {
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

  for (const rec of i.recoveries ?? []) if (rec.amount > 0) lines.push({ key: rec.key, label: rec.label, kind: "deduction", amount: r2(rec.amount) });

  if (i.tds > 0) lines.push({ key: "tds", label: "TDS on settlement", kind: "deduction", amount: r2(i.tds) });

  const earnings = r2(lines.filter((l) => l.kind === "earning").reduce((s, l) => s + l.amount, 0));
  const deductions = r2(lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.amount, 0));
  return { lines, earnings, deductions, net: r2(earnings - deductions), taxable: r2(taxable), service, notice: { required: i.noticeDays, served, shortfall }, gratuityEligible, ...(employerDues ? { employerDues } : {}) };
}

/** Default notice period: shorter while on probation. */
export function defaultNoticeDays(status: string, s: { noticeDays?: number; probationNoticeDays?: number }) {
  return status === "probation" ? (s.probationNoticeDays ?? 15) : (s.noticeDays ?? 30);
}
