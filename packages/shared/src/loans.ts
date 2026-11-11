/**
 * Employee loans and salary advances, recovered from salary in monthly instalments.
 * An advance is usually one or two months and interest-free; a loan can run longer and
 * may carry interest on the reducing balance.
 */
export const LOAN_TYPES = ["advance", "loan"] as const;
export type LoanType = (typeof LOAN_TYPES)[number];
export const LOAN_TYPE_LABEL: Record<LoanType, string> = { advance: "Salary advance", loan: "Loan" };

export const LOAN_STATUSES = ["requested", "approved", "active", "closed", "rejected", "cancelled", "written_off"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  requested: "Waiting for approval",
  approved: "Approved, not paid out",
  active: "Recovering",
  closed: "Repaid",
  rejected: "Rejected",
  cancelled: "Cancelled",
  written_off: "Written off",
};

export interface LoanPolicy {
  /** Employees can ask for advances and loans from self-service. */
  requests: boolean;
  /** Largest advance, as a share of monthly gross. */
  advanceMaxPctOfGross: number;
  advanceMaxMonths: number;
  /** Largest loan, in months of gross salary. */
  loanMaxMonthsOfGross: number;
  loanMaxMonths: number;
  /** Default annual interest for loans (0 for interest-free). */
  loanInterestPct: number;
}
export const DEFAULT_LOAN_POLICY: LoanPolicy = { requests: true, advanceMaxPctOfGross: 100, advanceMaxMonths: 3, loanMaxMonthsOfGross: 3, loanMaxMonths: 24, loanInterestPct: 0 };

/** Interest-free or concessional loans above this are a taxable perquisite (Rule 3(7)(i)). */
export const PERQUISITE_LOAN_LIMIT = 200000;

export interface ScheduleRow {
  n: number;
  month: string;
  emi: number;
  principal: number;
  interest: number;
  balance: number;
}

const r = (n: number) => Math.round(n);
export function addMonths(month: string, k: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 7);
}

/** Monthly instalment, rounded to the rupee: equal principal if interest-free, else reducing-balance EMI. */
export function emiFor(principal: number, annualPct: number, months: number) {
  if (months <= 0) return r(principal);
  const i = annualPct / 1200;
  if (!i) return Math.ceil(principal / months);
  return Math.ceil((principal * i * (1 + i) ** months) / ((1 + i) ** months - 1));
}

/**
 * Month-by-month schedule. Months in `skip` are paused and push the rest back. The last
 * instalment is whatever is left, so the total is exact.
 */
export function loanSchedule(principal: number, annualPct: number, months: number, startMonth: string, skip: string[] = []): ScheduleRow[] {
  const emi = emiFor(principal, annualPct, months);
  const i = annualPct / 1200;
  const out: ScheduleRow[] = [];
  let balance = principal;
  let month = startMonth;
  for (let n = 1; balance > 0 && n <= months + 120; ) {
    if (skip.includes(month)) {
      month = addMonths(month, 1);
      continue;
    }
    const interest = r(balance * i);
    let principalPart = Math.min(balance, emi - interest);
    if (principalPart <= 0) principalPart = balance; // guard against a rate too high to repay
    const last = n >= months || balance - principalPart <= 0;
    if (last) principalPart = balance;
    balance = r(balance - principalPart);
    out.push({ n, month, emi: principalPart + interest, principal: principalPart, interest, balance });
    month = addMonths(month, 1);
    n++;
  }
  return out;
}

/** Total to recover over the schedule (principal plus interest). */
export const totalPayable = (s: ScheduleRow[]) => s.reduce((t, x) => t + x.emi, 0);

/** Check a request against the company's limits. Returns a reason, or null if it's fine. */
export function loanLimitError(p: LoanPolicy, type: LoanType, amount: number, months: number, monthlyGross: number): string | null {
  if (amount <= 0) return "Enter an amount";
  if (type === "advance") {
    const max = r((monthlyGross * p.advanceMaxPctOfGross) / 100);
    if (monthlyGross > 0 && amount > max) return `An advance can be up to ${p.advanceMaxPctOfGross}% of your monthly gross (₹${max.toLocaleString("en-IN")})`;
    if (months > p.advanceMaxMonths) return `An advance is repaid within ${p.advanceMaxMonths} month${p.advanceMaxMonths === 1 ? "" : "s"}`;
  } else {
    const max = r(monthlyGross * p.loanMaxMonthsOfGross);
    if (monthlyGross > 0 && amount > max) return `A loan can be up to ${p.loanMaxMonthsOfGross} months of your gross salary (₹${max.toLocaleString("en-IN")})`;
    if (months > p.loanMaxMonths) return `A loan is repaid within ${p.loanMaxMonths} months`;
  }
  return null;
}
