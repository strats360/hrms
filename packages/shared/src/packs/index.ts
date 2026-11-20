import { COUNTRIES, type CountryCode } from "../countries";
import { indiaPack } from "./in";
import { uaePack } from "./ae";
import { saudiPack } from "./sa";
import { qatarPack } from "./gcc/qa";
import { kuwaitPack } from "./gcc/kw";
import { omanPack } from "./gcc/om";
import { bahrainPack } from "./gcc/bh";
import type { CountryPack } from "./types";

export type { CountryPack, StatutoryContext, StatutoryResult } from "./types";

/** Every built country pack. Packs still waiting for a local expert's sign off say so in `review`. */
const PACKS: Partial<Record<CountryCode, CountryPack>> = { IN: indiaPack, AE: uaePack, SA: saudiPack, QA: qatarPack, KW: kuwaitPack, OM: omanPack, BH: bahrainPack };

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
