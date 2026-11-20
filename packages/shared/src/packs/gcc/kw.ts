import { COUNTRIES } from "../../countries";
import type { CountryPack } from "../types";
import { amountWords, gccSettlement, gccStatutory, GULF_LABELS, yearsNote, type SocialInsurance } from "./common";

/**
 * Kuwait: Kuwaitis pay into PIFSS; expats pay nothing. The rates here add up the basic,
 * supplementary and unemployment parts on salary up to KWD 2,750.
 * Confirm: each part's rate and its own ceiling (the basic part stops at KWD 1,500).
 */
export const KUWAIT_PIFSS: SocialInsurance = {
  country: "KW",
  currency: "KWD",
  base: "gross",
  min: 0,
  max: 2750,
  nationals: { employee: [{ code: "pension", label: "PIFSS", rate: 0.105 }], employer: [{ code: "pension_er", label: "PIFSS", rate: 0.115 }] },
  others: { employee: [], employer: [] },
};

/**
 * End of service indemnity, Labour Law No. 6 of 2010, Article 51: 15 days' wage for each of the
 * first five years and a month's for each year after, at most 18 months' wage. Article 53 on
 * resignation: nothing under 3 years, half from 3 to 5, two thirds from 5 to 10, all from 10.
 */
export function kuwaitIndemnity(monthlyWage: number, serviceDays: number) {
  const years = serviceDays / 365;
  const raw = Math.min(years, 5) * 0.5 * monthlyWage + Math.max(0, years - 5) * monthlyWage;
  const cap = 18 * monthlyWage;
  return { amount: Math.min(raw, cap), note: `15 days × ${yearsNote(Math.min(years, 5))}${years > 5 ? ` + a month × ${yearsNote(years - 5)}` : ""} of wage${raw > cap ? ", capped at 18 months" : ""}` };
}
export const kuwaitResignationShare = (years: number) => (years >= 10 ? 1 : years >= 5 ? 2 / 3 : years >= 3 ? 0.5 : 0);

export const KUWAIT_GOVERNORATES = ["Al Asimah", "Hawalli", "Farwaniya", "Mubarak Al Kabeer", "Ahmadi", "Jahra"];

export const kuwaitPack: CountryPack = {
  code: "KW",
  info: COUNTRIES.KW,
  review: { status: "pending", note: "Built from Kuwaiti law, but not yet checked by a Kuwait payroll expert. Run payroll alongside your current system until golden/KW.json is signed off." },
  payroll: { statutory: (ctx) => gccStatutory(KUWAIT_PIFSS, ctx), componentLabels: GULF_LABELS, roundingDecimals: 3, amountInWords: amountWords("KWD", 3) },
  // Kuwaitis get the indemnity too; PIFSS covers part of it for some employers, which HR enters as a manual line
  settlement: (i) => gccSettlement(i, { nationalsCovered: null, award: (x, d) => kuwaitIndemnity(x.monthlyGross, d), resignationShare: kuwaitResignationShare, leaveOn: "gross", decimals: 3 }),
  publicHolidays: (y) => [
    { date: `${y}-01-01`, name: "New Year's Day", type: "national" },
    { date: `${y}-02-25`, name: "National Day", type: "national" },
    { date: `${y}-02-26`, name: "Liberation Day", type: "national" },
  ],
  regions: { label: "Governorate", list: KUWAIT_GOVERNORATES },
  entityRegistrations: [
    { key: "crNumber", label: "Commercial registration" },
    { key: "pamFileNumber", label: "PAM file number" },
    { key: "pifssNumber", label: "PIFSS employer number" },
  ],
  ruleCategories: ["pifss"],
};
