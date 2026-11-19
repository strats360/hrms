import { COUNTRIES, type CountryCode } from "../countries";
import { indiaPack } from "./in";
import type { CountryPack } from "./types";

export type { CountryPack, StatutoryContext, StatutoryResult } from "./types";

/** Every finished country pack. A country is listed here only once a local expert has signed it off. */
const PACKS: Partial<Record<CountryCode, CountryPack>> = { IN: indiaPack };

/** Countries with a finished pack, e.g. for golden payroll tests. */
export const PACK_CODES = Object.keys(PACKS) as CountryCode[];

/** The pack for a country. Throws for countries that don't have one yet. */
export function packFor(country: string | null | undefined = "IN"): CountryPack {
  const p = PACKS[(country ?? "IN") as CountryCode];
  if (!p) throw new Error(`${COUNTRIES[country as CountryCode]?.name ?? country} isn't supported yet`);
  return p;
}

export const hasPackFor = (country: string) => !!PACKS[country as CountryCode];
