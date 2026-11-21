/**
 * Maternity benefit under the Code on Social Security 2020 (chapter VI, carrying over the
 * Maternity Benefit Act 1961), and two OSH Code duties that sit next to it.
 *
 * - Delivery: 26 weeks, up to 8 of them before the expected date, for a woman with fewer than two
 *   surviving children; 12 weeks (up to 6 before) otherwise. She must have worked at least 80 days
 *   in the 12 months before the expected delivery.
 * - Adopting a child under three months, or a commissioning mother: 12 weeks from the day the
 *   child is handed over.
 * - Miscarriage or medical termination: 6 weeks after. Tubectomy: 2 weeks after.
 * - Pay is the average daily wage for each day of absence. When she's covered by ESI, ESIC pays
 *   and the employer doesn't. A medical bonus (₹3,500 under the old Act) is due when the employer
 *   provides no free pre and post natal care.
 */
export const MATERNITY_EVENTS = ["delivery", "adoption", "commissioning", "miscarriage", "tubectomy"] as const;
export type MaternityEvent = (typeof MATERNITY_EVENTS)[number];
export const MATERNITY_EVENT_LABELS: Record<MaternityEvent, string> = {
  delivery: "Delivery",
  adoption: "Adopting a child under three months",
  commissioning: "Commissioning mother (surrogacy)",
  miscarriage: "Miscarriage or medical termination",
  tubectomy: "Tubectomy",
};
export const MATERNITY_MEDICAL_BONUS = 3500;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface MaternityInput {
  event: MaternityEvent;
  /** Expected (or actual) delivery date, the handover date, or the day of the miscarriage or operation. */
  eventDate: string;
  /** For delivery: when leave starts. Defaults to the earliest allowed. */
  startDate?: string | null;
  survivingChildren: number;
  daysWorkedLast12Months: number;
  averageDailyWage: number;
  esiCovered: boolean;
  /** The employer provides free pre and post natal care, so no medical bonus is due. */
  freeMedicalCare?: boolean;
}

export function maternityBenefit(i: MaternityInput) {
  const reasons: string[] = [];
  const needsDays = i.event !== "adoption" && i.event !== "commissioning";
  if (needsDays && i.daysWorkedLast12Months < 80) reasons.push(`She has worked ${i.daysWorkedLast12Months} days in the 12 months before; 80 are needed`);
  let weeks = 0;
  let beforeWeeks = 0;
  if (i.event === "delivery") {
    weeks = i.survivingChildren < 2 ? 26 : 12;
    beforeWeeks = i.survivingChildren < 2 ? 8 : 6;
  } else if (i.event === "adoption" || i.event === "commissioning") weeks = 12;
  else if (i.event === "miscarriage") weeks = 6;
  else weeks = 2;
  const earliestStart = addDays(i.eventDate, -beforeWeeks * 7);
  let start = i.event === "delivery" ? (i.startDate ?? earliestStart) : i.event === "adoption" || i.event === "commissioning" ? i.eventDate : addDays(i.eventDate, 1);
  if (i.event === "delivery" && start < earliestStart) {
    reasons.push(`Leave can start at most ${beforeWeeks} weeks before the expected date, so from ${earliestStart}`);
    start = earliestStart;
  }
  if (i.event === "delivery" && start > i.eventDate) start = i.eventDate;
  const days = weeks * 7;
  const end = addDays(start, days - 1);
  const eligible = !reasons.some((r) => r.includes("80 are needed"));
  const paidBy: "esi" | "employer" = i.esiCovered ? "esi" : "employer";
  const amount = eligible ? r2(i.averageDailyWage * days) : 0;
  const medicalBonus = eligible && i.event === "delivery" && !i.freeMedicalCare && !i.esiCovered ? MATERNITY_MEDICAL_BONUS : 0;
  return { eligible, reasons, weeks, beforeWeeks, earliestStart, startDate: start, endDate: end, days, averageDailyWage: r2(i.averageDailyWage), amount, paidBy, employerPays: paidBy === "employer" ? amount + medicalBonus : 0, medicalBonus };
}

/**
 * OSH Code section 43: women may work before 6 am or after 7 pm only with their consent and the
 * safety and transport conditions the state sets. A shift is a night shift when any part of it
 * falls outside 06:00 to 19:00.
 */
export function isNightShift(start: string, end: string) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const s = m(start);
  const e = m(end);
  return s < 360 || e > 1140 || e < s;
}

/** OSH Code section 6: a free yearly health check for employees who are 40 or older. */
export function healthCheckDue(dateOfBirth: string | null, lastCheck: string | null, today: string) {
  if (!dateOfBirth) return { age: null, due: false };
  const age = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4)) - (today.slice(5) < dateOfBirth.slice(5) ? 1 : 0);
  if (age < 40) return { age, due: false };
  const nextBy = lastCheck ? `${Number(lastCheck.slice(0, 4)) + 1}${lastCheck.slice(4)}` : today;
  return { age, due: nextBy <= today, nextBy };
}
