import { COUNTRIES } from "../../countries";
import type { CountryPack } from "../types";
import { amountWords, gccSettlement, gccStatutory, GULF_LABELS, yearsNote, type SocialInsurance } from "./common";

/**
 * Qatar: Qataris pay into GRSIA under Social Insurance Law No. 1 of 2022; expats pay nothing.
 * Confirm: the rates, the contribution salary (basic plus social and housing allowances) and its cap.
 */
export const QATAR_PENSION: SocialInsurance = {
  country: "QA",
  currency: "QAR",
  base: "basic_housing",
  min: 0,
  max: 100000,
  nationals: { employee: [{ code: "pension", label: "GRSIA pension", rate: 0.07 }], employer: [{ code: "pension_er", label: "GRSIA pension", rate: 0.14 }] },
  others: { employee: [], employer: [] },
};

/**
 * End of service gratuity, Labour Law No. 14 of 2004, Article 54: at least three weeks' basic wage
 * for each year after the first, part years pro rata. Resigning doesn't reduce it.
 */
export function qatarGratuity(monthlyBasic: number, serviceDays: number) {
  if (serviceDays < 365) return null;
  const years = serviceDays / 365;
  return { amount: (monthlyBasic / 30) * 21 * years, note: `21 days × ${yearsNote(years)} of basic / 30` };
}

/** Qatar's National Sports Day: the second Tuesday of February. */
function sportsDay(y: number) {
  const first = new Date(Date.UTC(y, 1, 1)).getUTCDay();
  const day = 1 + ((2 - first + 7) % 7) + 7;
  return `${y}-02-${String(day).padStart(2, "0")}`;
}

export const QATAR_MUNICIPALITIES = ["Doha", "Al Rayyan", "Al Wakrah", "Al Khor", "Al Shamal", "Umm Salal", "Al Daayen", "Al Shahaniya"];

export const qatarPack: CountryPack = {
  code: "QA",
  info: COUNTRIES.QA,
  review: { status: "pending", note: "Built from Qatari law, but not yet checked by a Qatar payroll expert. Run payroll alongside your current system until golden/QA.json is signed off." },
  payroll: { statutory: (ctx) => gccStatutory(QATAR_PENSION, ctx), componentLabels: GULF_LABELS, roundingDecimals: 2, amountInWords: amountWords("QAR", 2) },
  settlement: (i) => gccSettlement(i, { nationalsCovered: "QA", award: (x, d) => qatarGratuity(x.monthlyBasic, d), leaveOn: "basic", decimals: 2 }),
  publicHolidays: (y) => [
    { date: sportsDay(y), name: "National Sports Day", type: "national" },
    { date: `${y}-12-18`, name: "National Day", type: "national" },
  ],
  regions: { label: "Municipality", list: QATAR_MUNICIPALITIES },
  entityRegistrations: [
    { key: "crNumber", label: "Commercial registration (CR)" },
    { key: "establishmentId", label: "MoL establishment ID (WPS employer ID)" },
    { key: "payerBank", label: "Salary bank short name (WPS)" },
    { key: "payerIban", label: "Salary account IBAN (WPS)" },
  ],
  ruleCategories: ["grsia"],
};
