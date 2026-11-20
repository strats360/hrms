import { COUNTRIES, type CountryCode } from "../countries";
import { indiaPack } from "./in";
import { uaePack } from "./ae";
import { saudiPack } from "./sa";
import { qatarPack } from "./gcc/qa";
import { kuwaitPack } from "./gcc/kw";
import { omanPack } from "./gcc/om";
import { bahrainPack } from "./gcc/bh";
import { ukPack } from "./gb";
import { usPack } from "./us";
import { canadaPack } from "./ca";
import type { CountryPack } from "./types";

export type { CountryPack, StatutoryContext, StatutoryResult } from "./types";

/** Every built country pack. Packs still waiting for a local expert's sign off say so in `review`. */
const PACKS: Partial<Record<CountryCode, CountryPack>> = { IN: indiaPack, AE: uaePack, SA: saudiPack, QA: qatarPack, KW: kuwaitPack, OM: omanPack, BH: bahrainPack, GB: ukPack, US: usPack, CA: canadaPack };

/** Countries with a finished pack, e.g. for golden payroll tests. */
export const PACK_CODES = Object.keys(PACKS) as CountryCode[];

/** The pack for a country. Throws for countries that don't have one yet. */
export function packFor(country: string | null | undefined = "IN"): CountryPack {
  const p = PACKS[(country ?? "IN") as CountryCode];
  if (!p) throw new Error(`${COUNTRIES[country as CountryCode]?.name ?? country} isn't supported yet`);
  return p;
}

export const hasPackFor = (country: string) => !!PACKS[country as CountryCode];

export { EMIRATES } from "./ae";
export { buildWpsSif, checkWps, type WpsEmployee, type WpsFile } from "./ae/wps";
export { emiratisationStatus } from "./ae/emiratisation";
export { uaeGratuity } from "./ae/settlement";
export { EMIRATISATION_CONFIRM, EMIRATISATION_MIN_EMPLOYEES, GPSSA, ADPF } from "./ae/rules";

export { SAUDI_REGIONS } from "./sa";
export { buildMudadSheet, checkMudad, type MudadEmployee, type MudadSheet } from "./sa/mudad";
export { saudizationStatus } from "./sa/saudization";
export { saudiEndOfService, resignationShare } from "./sa/settlement";
export { annuityRate } from "./sa/payroll";
export { GOSI_WAGE, NITAQAT_CONFIRM } from "./sa/rules";

export { buildQatarWps, checkQatarWps, type QatarWpsEmployee, type QatarWpsFile } from "./gcc/qa-wps";
export { qatarGratuity, QATAR_PENSION } from "./gcc/qa";
export { kuwaitIndemnity, kuwaitResignationShare, KUWAIT_PIFSS } from "./gcc/kw";
export { omanGratuity, OMAN_SPF } from "./gcc/om";
export { bahrainIndemnity, BAHRAIN_SIO } from "./gcc/bh";

export { parseTaxCode, payeThisMonth, type TaxCode } from "./gb/tax";
export { classOneNi, taxMonthOf, taxYearOf } from "./gb/payroll";
export { ukPayrollProfileSchema, STUDENT_LOAN_OPTIONS, type UkPayrollProfile } from "./gb/profile";
export { NI_CATEGORIES, TAX_YEAR as UK_TAX_YEAR } from "./gb/rules";
export { englandBankHolidays } from "./gb/holidays";

export { federalWithholding } from "./us/payroll";
export { usPayrollProfileSchema, type UsPayrollProfile } from "./us/profile";
export { FILING_STATUSES, US_STATES } from "./us/rules";
export { usFederalHolidays } from "./us/holidays";

export { eiThisMonth, federalBpa, incomeTaxThisMonth, ontarioHealthPremium, pensionThisMonth } from "./ca/payroll";
export { caPayrollProfileSchema, type CaPayrollProfile } from "./ca/profile";
export { PROVINCES } from "./ca/rules";
export { ontarioHolidays } from "./ca/holidays";
export { ontarioNoticeWeeks } from "./ca/settlement";
