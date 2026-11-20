import { COUNTRIES } from "../../countries";
import type { CountryPack } from "../types";
import { amountWords, gccSettlement, gccStatutory, GULF_LABELS, yearsNote, type SocialInsurance } from "./common";

/**
 * Oman: the Social Protection Fund under the Social Protection Law (Royal Decree 52/2023).
 * Omanis pay pension and job security; employers also pay work injury, which since July 2024
 * covers expats too. Confirm: every rate, the OMR 3,000 ceiling, and the start dates.
 */
export const OMAN_SPF: SocialInsurance = {
  country: "OM",
  currency: "OMR",
  base: "gross",
  min: 0,
  max: 3000,
  nationals: {
    employee: [
      { code: "pension", label: "SPF pension", rate: 0.07 },
      { code: "job_security", label: "Job security", rate: 0.01 },
    ],
    employer: [
      { code: "pension_er", label: "SPF pension", rate: 0.115 },
      { code: "injury_er", label: "Work injury", rate: 0.01 },
      { code: "job_security_er", label: "Job security", rate: 0.01 },
    ],
  },
  others: { employee: [], employer: [{ code: "injury_er", label: "Work injury", rate: 0.01 }] },
};

/**
 * End of service gratuity for expats, Labour Law (Royal Decree 53/2023): a month's basic wage for
 * each year, part years pro rata, after a year's service. Omanis get theirs from the SPF.
 */
export function omanGratuity(monthlyBasic: number, serviceDays: number) {
  if (serviceDays < 365) return null;
  const years = serviceDays / 365;
  return { amount: monthlyBasic * years, note: `a month × ${yearsNote(years)} of basic` };
}

export const OMAN_GOVERNORATES = ["Muscat", "Dhofar", "Musandam", "Al Buraimi", "Ad Dakhiliyah", "North Al Batinah", "South Al Batinah", "North Ash Sharqiyah", "South Ash Sharqiyah", "Adh Dhahirah", "Al Wusta"];

export const omanPack: CountryPack = {
  code: "OM",
  info: COUNTRIES.OM,
  review: { status: "pending", note: "Built from Omani law, but not yet checked by an Oman payroll expert. Run payroll alongside your current system until golden/OM.json is signed off." },
  payroll: { statutory: (ctx) => gccStatutory(OMAN_SPF, ctx), componentLabels: GULF_LABELS, roundingDecimals: 3, amountInWords: amountWords("OMR", 3) },
  settlement: (i) => gccSettlement(i, { nationalsCovered: "OM", award: (x, d) => omanGratuity(x.monthlyBasic, d), leaveOn: "gross", decimals: 3 }),
  // National Day and the Sultan's Accession Day; the government sets the exact days off each year
  publicHolidays: (y) => [
    { date: `${y}-01-11`, name: "Sultan's Accession Day", type: "national" },
    { date: `${y}-11-18`, name: "National Day", type: "national" },
  ],
  regions: { label: "Governorate", list: OMAN_GOVERNORATES },
  entityRegistrations: [
    { key: "crNumber", label: "Commercial registration (CR)" },
    { key: "molEstablishmentId", label: "Ministry of Labour establishment number" },
    { key: "spfNumber", label: "Social Protection Fund number" },
    { key: "vatNumber", label: "VAT number" },
  ],
  ruleCategories: ["spf"],
};
