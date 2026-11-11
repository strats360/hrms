import type { LoanPolicy, LoanStatus, LoanType } from "@hrms/shared";
import type { Tone } from "@/components/ui/tag";

export interface LoanRow {
  id: string;
  code: string;
  type: LoanType;
  typeLabel: string;
  status: LoanStatus;
  statusLabel: string;
  amount: number;
  interestPct: number;
  months: number;
  startMonth: string;
  skipMonths: string[];
  reason: string | null;
  decisionNote: string | null;
  paidOn: string | null;
  paidMethod: string | null;
  paidReference: string | null;
  closedOn: string | null;
  createdAt: string;
  emi: number;
  payable: number;
  recovered: number;
  pending: number;
  outstanding: number;
  nextMonth: string | null;
  endMonth: string | null;
  employeeId?: string;
  employeeName?: string;
  employeeCode?: string;
}
export interface LoanList {
  rows: LoanRow[];
  summary: { requested: number; active: number; outstanding: number; monthly: number };
  policy: LoanPolicy;
  firstOpenMonth: string;
}
export interface LoanDetail {
  loan: LoanRow;
  employee: { name: string; code: string; status: string };
  schedule: { n: number; month: string; emi: number; principal: number; interest: number; balance: number; recovered: { month: string; amount: number; locked: boolean } | null }[];
  repayments: { id: string; amount: number; paidOn: string; source: string; note: string | null }[];
  warnings: string[];
  firstOpenMonth: string;
}

export const LOAN_TONE: Record<LoanStatus, Tone> = { requested: "warn", approved: "accent", active: "ok", closed: "neutral", rejected: "bad", cancelled: "neutral", written_off: "neutral" };
export const monthLabel = (m: string | null) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const METHOD_LABEL: Record<string, string> = { bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque" };
