/**
 * Statutory compliance helpers: due dates, ECR file lines, return summaries.
 * As with payroll.ts, dates and formats are data that a payroll consultant should
 * confirm for each state before go-live.
 */
import { daysInMonth } from "./format";
import { DEFAULT_RULES, STATUTORY, type StatutoryRules } from "./payroll";

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
  "Andhra Pradesh": 10,
  Telangana: 10,
  "Madhya Pradesh": 10,
  Assam: 28,
  Nagaland: 28,
  Gujarat: 15,
  Punjab: 15,
  Tripura: 15,
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

/** Quarterly salary TDS return (Form 24Q, Form 138 from 2026-27) due dates for a year "2026-27". The last entry is the annual certificate. */
export function tdsReturnDueDates(fy: string) {
  const y = Number(fy.slice(0, 4));
  return [
    { quarter: "Q1", period: `Apr–Jun ${y}`, due: `${y}-07-31` },
    { quarter: "Q2", period: `Jul–Sep ${y}`, due: `${y}-10-31` },
    { quarter: "Q3", period: `Oct–Dec ${y}`, due: `${y + 1}-01-31` },
    { quarter: "Q4", period: `Jan–Mar ${y + 1}`, due: `${y + 1}-05-31` },
    { quarter: "certificate", period: `FY ${fy}`, due: `${y + 1}-06-15` },
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
export function pfWages(basicEarned: number, onFullBasic = false, ceiling: number = STATUTORY.pf.wageCeiling) {
  const epf = onFullBasic ? basicEarned : Math.min(basicEarned, ceiling);
  return { epf, eps: Math.min(epf, ceiling), edli: Math.min(epf, ceiling) };
}

/** Group employees into the state's PT slabs for the PT return. */
export function ptSlabSummary(state: string, rows: { gross: number; pt: number }[], R: StatutoryRules = DEFAULT_RULES) {
  const rule = R.pt[state];
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

/**
 * Obligations that switch on at a headcount (India HR compliance report, section 2). "employees"
 * counts everyone; "workers" leaves out managers and supervisors earning over ₹18,000 a month,
 * as the IR and OSH Codes do. Count per establishment; once EPF or ESI covers you, it stays.
 */
export const HEADCOUNT_THRESHOLDS: { at: number; count: "employees" | "workers"; obligation: string; law: string }[] = [
  { at: 10, count: "employees", obligation: "ESI registration (staff on wages up to ₹21,000)", law: "Social Security Code" },
  { at: 10, count: "employees", obligation: "Gratuity", law: "Social Security Code" },
  { at: 10, count: "employees", obligation: "Maternity benefit", law: "Social Security Code" },
  { at: 10, count: "employees", obligation: "POSH Internal Committee, policy and annual report", law: "POSH Act 2013" },
  { at: 10, count: "workers", obligation: "Labour Code registration, appointment letters, registers, annual return", law: "OSH Code" },
  { at: 20, count: "employees", obligation: "EPF registration and contributions", law: "Social Security Code" },
  { at: 20, count: "employees", obligation: "Statutory bonus", law: "Code on Wages" },
  { at: 20, count: "workers", obligation: "Grievance Redressal Committee", law: "IR Code" },
  { at: 20, count: "employees", obligation: "Report vacancies to career centres", law: "Social Security Code" },
  { at: 20, count: "employees", obligation: "Register an equal opportunity policy and appoint a liaison officer", law: "RPwD Act 2016" },
  { at: 30, count: "employees", obligation: "Engage apprentices (2.5% to 15% of the workforce)", law: "Apprentices Act 1961" },
  { at: 50, count: "employees", obligation: "Creche facility", law: "Social Security Code" },
  { at: 100, count: "workers", obligation: "Canteen, and a Works Committee if the government orders it", law: "OSH Code, IR Code" },
  { at: 100, count: "employees", obligation: "HIV/AIDS complaints officer", law: "HIV/AIDS Act 2017" },
  { at: 250, count: "workers", obligation: "Welfare officer (factories, mines, plantations)", law: "OSH Code" },
  { at: 300, count: "workers", obligation: "Certified Standing Orders; permission for lay-off, retrenchment or closure (factories, mines, plantations)", law: "IR Code" },
  { at: 500, count: "workers", obligation: "Safety Committee", law: "OSH Code" },
];

/** Which thresholds an establishment has crossed, and which it's close to (within 20%). */
export function headcountObligations(counts: { employees: number; workers: number }) {
  return HEADCOUNT_THRESHOLDS.map((t) => {
    const n = counts[t.count];
    return { ...t, current: n, status: n >= t.at ? ("applies" as const) : n >= Math.ceil(t.at * 0.8) ? ("near" as const) : ("not_yet" as const) };
  });
}

/** Supervisors and managers earning over this aren't "workers" under the IR and OSH Codes. */
export const WORKER_WAGE_LIMIT = 18000;

/**
 * Yearly dates on the Indian compliance calendar that don't come from a payroll month: POSH annual
 * report, the unified annual return, statutory bonus, minimum wage revisions
 * and ESI contribution periods. Returns those between `from` and `to`.
 */
export function indiaYearlyDates(from: string, to: string) {
  const out: { date: string; title: string }[] = [];
  const y0 = Number(from.slice(0, 4));
  for (const y of [y0 - 1, y0, y0 + 1]) {
    out.push(
      { date: `${y}-01-31`, title: `POSH annual report for ${y - 1} to the District Officer` },
      { date: `${y}-02-28`, title: `Unified annual return under the Labour Codes for ${y - 1} (check your state's date)` },
      { date: `${y}-04-01`, title: "Minimum wage revision (VDA): load the new rates. ESI contribution period starts" },
      { date: `${y}-10-01`, title: "Minimum wage revision (VDA): load the new rates. ESI contribution period starts" },
      { date: `${y}-11-30`, title: `Statutory bonus for ${y - 1}-${String(y % 100).padStart(2, "0")} due` },
    );
  }
  return out.filter((d) => d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}
