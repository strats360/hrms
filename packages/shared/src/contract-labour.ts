import { z } from "zod";

/**
 * Contract labour under the OSH Code 2020 (chapter XI). A principal employer with 50 or more
 * contract workers on any day in the last year must register; a contractor with 50 or more workers
 * needs a licence. The principal employer makes sure the contractor pays wages on time (by the 7th
 * of the next month under the Code on Wages) and deposits PF and ESI, and pays them itself if the
 * contractor doesn't.
 */
export const CONTRACT_LABOUR_THRESHOLD = 50;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

export const contractLabourSchema = z.object({
  suppliesLabour: z.boolean(),
  labourLicence: opt(z.string().trim().max(60)),
  licenceValidUntil: opt(isoDate),
  workNature: opt(z.string().trim().max(160)),
  branchId: opt(z.string().min(1)),
  contractFrom: opt(isoDate),
  contractTo: opt(isoDate),
});

export const contractWorkerSchema = z.object({
  name: z.string().trim().min(1, "Enter the worker's name").max(120),
  gender: z.enum(["female", "male", "other"]),
  dateOfBirth: opt(isoDate),
  aadhaarLast4: opt(z.string().regex(/^\d{4}$/, "Last four digits only")),
  uan: opt(z.string().regex(/^\d{12}$/, "UAN is 12 digits")),
  esicIpNumber: opt(z.string().regex(/^\d{10}$/, "ESIC IP number is 10 digits")),
  joinedOn: isoDate,
  leftOn: opt(isoDate),
  dailyWage: z.coerce.number().min(0).max(100000),
});

export const contractMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  workers: z.coerce.number().int().min(0).max(100000),
  wagesPaidOn: opt(isoDate),
  pfChallan: opt(z.string().trim().max(60)),
  esiChallan: opt(z.string().trim().max(60)),
  note: opt(z.string().trim().max(500)),
});

export interface LabourContractor {
  id: string;
  name: string;
  labourLicence?: string | null;
  licenceValidUntil?: string | null;
  contractTo?: string | null;
}
export interface LabourWorker {
  contractorId: string;
  joinedOn: string;
  leftOn?: string | null;
  dailyWage: number;
  age?: number | null;
}
export interface LabourMonth {
  contractorId: string;
  month: string;
  wagesPaidOn?: string | null;
  pfChallan?: string | null;
  esiChallan?: string | null;
}

const prevMonth = (today: string) => {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const active = (w: LabourWorker, on: string) => w.joinedOn <= on && (!w.leftOn || w.leftOn >= on);

/** What the principal employer should follow up, per contractor and overall. */
export function contractLabourChecks(contractors: LabourContractor[], workers: LabourWorker[], months: LabourMonth[], opts: { today: string; minDailyWage?: number | null }) {
  const { today } = opts;
  const last = prevMonth(today);
  const dueBy = `${today.slice(0, 7)}-07`;
  const rows = contractors.map((k) => {
    const mine = workers.filter((w) => w.contractorId === k.id);
    const now = mine.filter((w) => active(w, today)).length;
    const issues: string[] = [];
    if (now >= CONTRACT_LABOUR_THRESHOLD && !k.labourLicence) issues.push(`${now} workers: the contractor needs a licence`);
    if (k.labourLicence && k.licenceValidUntil && k.licenceValidUntil < today) issues.push("The contractor's licence has expired");
    if (k.contractTo && k.contractTo < today && now) issues.push(`The contract ended on ${k.contractTo} but ${now} workers are still on it`);
    if (opts.minDailyWage) {
      const low = mine.filter((w) => active(w, today) && w.dailyWage < opts.minDailyWage!).length;
      if (low) issues.push(`${low} worker${low === 1 ? " is" : "s are"} paid below the minimum wage`);
    }
    const young = mine.filter((w) => active(w, today) && w.age != null && w.age < 18).length;
    if (young) issues.push(`${young} worker${young === 1 ? " is" : "s are"} under 18`);
    const m = months.find((x) => x.contractorId === k.id && x.month === last);
    const hadWorkers = mine.some((w) => w.joinedOn <= `${last}-31` && (!w.leftOn || w.leftOn >= `${last}-01`));
    if (hadWorkers) {
      if (!m?.wagesPaidOn) issues.push(today > dueBy ? `${last} wages not confirmed paid; they were due by the 7th` : `Confirm ${last} wages are paid by the 7th`);
      else if (m.wagesPaidOn > `${today.slice(0, 7)}-07` && m.wagesPaidOn.slice(0, 7) === today.slice(0, 7)) issues.push(`${last} wages were paid late, on ${m.wagesPaidOn}`);
      if (m && (!m.pfChallan || !m.esiChallan)) issues.push(`Get the ${last} ${!m.pfChallan && !m.esiChallan ? "PF and ESI" : !m.pfChallan ? "PF" : "ESI"} challan from the contractor`);
    }
    return { contractorId: k.id, name: k.name, workers: now, issues };
  });
  const total = rows.reduce((s, r) => s + r.workers, 0);
  // the most contract workers on any day in the last year is what counts for registration
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const days = new Set(workers.flatMap((w) => [w.joinedOn, w.leftOn ?? today]).filter((d) => d >= yearAgo && d <= today).concat(today));
  const peak = Math.max(0, ...[...days].map((d) => workers.filter((w) => active(w, d)).length));
  return { rows, total, peak, registrationNeeded: peak >= CONTRACT_LABOUR_THRESHOLD };
}
