/**
 * Statutory compliance helpers: due dates, ECR file lines, return summaries.
 * As with payroll.ts, dates and formats are data that a payroll consultant should
 * confirm for each state before go-live.
 */
import { daysInMonth } from "./format";
import { PT_RULES, STATUTORY } from "./payroll";

export const STATUTES = ["epf", "esi", "pt", "lwf", "tds"] as const;
export type Statute = (typeof STATUTES)[number];

export const STATUTE_LABELS: Record<Statute, string> = {
  epf: "EPF & EPS (ECR)",
  esi: "ESI",
  pt: "Professional Tax",
  lwf: "Labour Welfare Fund",
  tds: "TDS on salary (Challan 281)",
};

const pad = (n: number) => String(n).padStart(2, "0");
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${pad(daysInMonth(y, m))}`;
};

/** PT payment day per state: day of the following month, or "same-month-end". Default 15th of next month. */
const PT_DUE: Record<string, number | "same-month-end"> = {
  Maharashtra: "same-month-end",
  Karnataka: 20,
  "West Bengal": 21,
};

/**
 * Due date (YYYY-MM-DD) for a statute's payment for wage month `month` (YYYY-MM).
 * - EPF/ESI: 15th of the following month
 * - TDS: 7th of the following month; March is due 30 April
 * - PT: state specific (default 15th of the following month)
 * - LWF (Gujarat/Maharashtra): June contributions by 15 July, December by 15 January
 */
export function dueDate(statute: Statute, month: string, state?: string | null): string {
  const nm = nextMonth(month);
  switch (statute) {
    case "epf":
    case "esi":
      return `${nm}-15`;
    case "tds":
      return month.endsWith("-03") ? `${month.slice(0, 4)}-04-30` : `${nm}-07`;
    case "pt": {
      const rule = state ? PT_DUE[state] : undefined;
      if (rule === "same-month-end") return lastDay(month);
      return `${nm}-${pad(typeof rule === "number" ? rule : 15)}`;
    }
    case "lwf":
      return `${nm}-15`;
  }
}

/** Quarterly TDS return (24Q) due dates for a financial year "2026-27". */
export function tdsReturnDueDates(fy: string) {
  const y = Number(fy.slice(0, 4));
  return [
    { quarter: "Q1", period: `Apr–Jun ${y}`, due: `${y}-07-31` },
    { quarter: "Q2", period: `Jul–Sep ${y}`, due: `${y}-10-31` },
    { quarter: "Q3", period: `Oct–Dec ${y}`, due: `${y + 1}-01-31` },
    { quarter: "Q4", period: `Jan–Mar ${y + 1}`, due: `${y + 1}-05-31` },
    { quarter: "Form 16", period: `FY ${fy}`, due: `${y + 1}-06-15` },
  ];
}

/** Whole days from `today` to `due` (negative when overdue). */
export function daysUntil(due: string, today: string) {
  return Math.round((Date.parse(due + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
}

// ---------------------------------------------------------------------------
// EPF electronic challan-cum-return (ECR 2.0) text line
// ---------------------------------------------------------------------------
export interface EcrMember {
  uan: string;
  name: string;
  grossWages: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epfEe: number; // employee share
  eps: number; // employer share to pension
  epfEr: number; // employer share to EPF (EPF - EPS difference)
  ncpDays: number; // non-contributory (LOP) days
  refund?: number;
}

/** One ECR 2.0 line: 11 fields separated by #~#, whole rupees, name in capitals. */
export function ecrLine(m: EcrMember) {
  const n = (v: number) => String(Math.round(v));
  const name = m.name.toUpperCase().replace(/[^A-Z .]/g, "").replace(/\s+/g, " ").trim();
  return [m.uan, name, n(m.grossWages), n(m.epfWages), n(m.epsWages), n(m.edliWages), n(m.epfEe), n(m.eps), n(m.epfEr), String(Math.round(m.ncpDays)), n(m.refund ?? 0)].join("#~#");
}

/** PF wage and its EPS/EDLI parts from earned basic (capped unless contributing on full basic). */
export function pfWages(basicEarned: number, onFullBasic = false) {
  const ceiling = STATUTORY.pf.wageCeiling;
  const epf = onFullBasic ? basicEarned : Math.min(basicEarned, ceiling);
  return { epf, eps: Math.min(epf, ceiling), edli: Math.min(epf, ceiling) };
}

/** Group employees into the state's PT slabs for the PT return. */
export function ptSlabSummary(state: string, rows: { gross: number; pt: number }[]) {
  const rule = PT_RULES[state];
  if (!rule) return [];
  const slabs = rule.slabs.map(([upTo, amount], i) => ({ from: i === 0 ? 0 : rule.slabs[i - 1]![0] + 1, upTo, rate: amount, employees: 0, amount: 0 }));
  for (const r of rows) {
    const idx = slabs.findIndex((s) => r.gross <= s.upTo);
    const s = slabs[idx === -1 ? slabs.length - 1 : idx]!;
    s.employees++;
    s.amount += r.pt;
  }
  return slabs;
}
