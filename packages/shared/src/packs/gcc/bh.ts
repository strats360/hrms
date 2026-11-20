import { COUNTRIES } from "../../countries";
import { daysBetweenInclusive } from "../../fnf";
import type { CountryPack } from "../types";
import { amountWords, gccSettlement, gccStatutory, GULF_LABELS, yearsNote, type SocialInsurance } from "./common";

/** From March 2024, employers pay expats' leaving indemnity to the SIO every month instead of at the end. */
export const BAHRAIN_INDEMNITY_FROM = "2024-03-01";

/**
 * Bahrain: SIO social insurance on the wage up to BHD 4,000. Bahrainis pay pension and
 * unemployment; expats pay unemployment, and their employer pays work injury and the monthly
 * leaving indemnity (4.2% for the first three years of service, 8.4% after).
 * Confirm: every rate and the ceiling.
 */
export const BAHRAIN_SIO: SocialInsurance = {
  country: "BH",
  currency: "BHD",
  base: "gross",
  min: 0,
  max: 4000,
  nationals: {
    employee: [
      { code: "pension", label: "SIO pension", rate: 0.06 },
      { code: "unemployment", label: "Unemployment insurance", rate: 0.01 },
    ],
    employer: [
      { code: "pension_er", label: "SIO pension", rate: 0.12 },
      { code: "injury_er", label: "Work injury", rate: 0.03 },
      { code: "unemployment_er", label: "Unemployment insurance", rate: 0.01 },
    ],
  },
  others: {
    employee: [{ code: "unemployment", label: "Unemployment insurance", rate: 0.01 }],
    employer: [
      { code: "injury_er", label: "Work injury", rate: 0.03 },
      { code: "unemployment_er", label: "Unemployment insurance", rate: 0.01 },
    ],
  },
  extra: (ctx, base) => {
    const joined = ctx.input.profile?.joinedOn;
    const years = joined ? daysBetweenInclusive(joined, `${ctx.input.month}-01`) / 365 : 0;
    const rate = years >= 3 ? 0.084 : 0.042;
    return { employee: [], employer: [{ code: "indemnity_er", label: `Leaving indemnity to SIO (${rate * 100}%)`, amount: ctx.round(base * rate) }] };
  },
};

/**
 * End of service for expats, Labour Law No. 36 of 2012, Article 116: half a month's wage for each
 * of the first three years and a month's for each year after, for service before March 2024.
 * Service from then on is paid out by the SIO from the monthly contributions.
 */
export function bahrainIndemnity(monthlyWage: number, dateOfJoining: string, lastWorkingDay: string) {
  if (daysBetweenInclusive(dateOfJoining, lastWorkingDay) < 365) return null;
  if (dateOfJoining >= BAHRAIN_INDEMNITY_FROM) return null;
  const end = lastWorkingDay < BAHRAIN_INDEMNITY_FROM ? lastWorkingDay : "2024-02-29";
  const years = daysBetweenInclusive(dateOfJoining, end) / 365;
  const amount = Math.min(years, 3) * 0.5 * monthlyWage + Math.max(0, years - 3) * monthlyWage;
  return { amount, note: `half a month × ${yearsNote(Math.min(years, 3))}${years > 3 ? ` + a month × ${yearsNote(years - 3)}` : ""} of wage, for service before March 2024 (the SIO pays the rest)` };
}

export const BAHRAIN_GOVERNORATES = ["Capital", "Muharraq", "Northern", "Southern"];

export const bahrainPack: CountryPack = {
  code: "BH",
  info: COUNTRIES.BH,
  review: { status: "pending", note: "Built from Bahraini law, but not yet checked by a Bahrain payroll expert. Run payroll alongside your current system until golden/BH.json is signed off." },
  payroll: { statutory: (ctx) => gccStatutory(BAHRAIN_SIO, ctx), componentLabels: GULF_LABELS, roundingDecimals: 3, amountInWords: amountWords("BHD", 3) },
  settlement: (i) => gccSettlement(i, { nationalsCovered: "BH", award: (x) => bahrainIndemnity(x.monthlyGross, x.dateOfJoining, x.lastWorkingDay), leaveOn: "gross", decimals: 3 }),
  publicHolidays: (y) => [
    { date: `${y}-01-01`, name: "New Year's Day", type: "national" },
    { date: `${y}-05-01`, name: "Labour Day", type: "national" },
    { date: `${y}-12-16`, name: "National Day", type: "national" },
    { date: `${y}-12-17`, name: "National Day holiday", type: "national" },
  ],
  regions: { label: "Governorate", list: BAHRAIN_GOVERNORATES },
  entityRegistrations: [
    { key: "crNumber", label: "Commercial registration (CR)" },
    { key: "lmraNumber", label: "LMRA employer number" },
    { key: "sioNumber", label: "SIO employer number" },
    { key: "vatNumber", label: "VAT number" },
  ],
  ruleCategories: ["sio"],
};
