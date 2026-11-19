/**
 * Countries Saralix plans to support. A country is only usable for a legal entity when it
 * has a country pack (`hasPack`) and the instance allows it (ALLOWED_COUNTRIES). See docs/MULTI_COUNTRY.md.
 */
export const COUNTRY_CODES = ["IN", "AE", "SA", "QA", "KW", "OM", "GB", "US"] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export interface CountryInfo {
  code: CountryCode;
  name: string;
  /** ISO 4217 */
  currency: string;
  /** Minor units: 2 for INR, 3 for KWD and OMR. */
  decimals: number;
  /** IANA zone used when an entity doesn't pick one. Countries with several zones list the most common. */
  timeZone: string;
  timeZones: string[];
  /** Usual weekend, 0 = Sunday. */
  weekend: number[];
  /** True once the country's pack (payroll, statutory, filings) is built and signed off. */
  hasPack: boolean;
}

export const COUNTRIES: Record<CountryCode, CountryInfo> = {
  IN: { code: "IN", name: "India", currency: "INR", decimals: 2, timeZone: "Asia/Kolkata", timeZones: ["Asia/Kolkata"], weekend: [0, 6], hasPack: true },
  AE: { code: "AE", name: "United Arab Emirates", currency: "AED", decimals: 2, timeZone: "Asia/Dubai", timeZones: ["Asia/Dubai"], weekend: [0, 6], hasPack: false },
  SA: { code: "SA", name: "Saudi Arabia", currency: "SAR", decimals: 2, timeZone: "Asia/Riyadh", timeZones: ["Asia/Riyadh"], weekend: [5, 6], hasPack: false },
  QA: { code: "QA", name: "Qatar", currency: "QAR", decimals: 2, timeZone: "Asia/Qatar", timeZones: ["Asia/Qatar"], weekend: [5, 6], hasPack: false },
  KW: { code: "KW", name: "Kuwait", currency: "KWD", decimals: 3, timeZone: "Asia/Kuwait", timeZones: ["Asia/Kuwait"], weekend: [5, 6], hasPack: false },
  OM: { code: "OM", name: "Oman", currency: "OMR", decimals: 3, timeZone: "Asia/Muscat", timeZones: ["Asia/Muscat"], weekend: [5, 6], hasPack: false },
  GB: { code: "GB", name: "United Kingdom", currency: "GBP", decimals: 2, timeZone: "Europe/London", timeZones: ["Europe/London"], weekend: [0, 6], hasPack: false },
  US: {
    code: "US",
    name: "United States",
    currency: "USD",
    decimals: 2,
    timeZone: "America/New_York",
    timeZones: ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"],
    weekend: [0, 6],
    hasPack: false,
  },
};

export const isCountryCode = (v: unknown): v is CountryCode => typeof v === "string" && (COUNTRY_CODES as readonly string[]).includes(v);

/**
 * Countries an instance lets entities use: those it allows (comma separated codes, default India)
 * that also have a pack.
 */
export function allowedCountries(allowed?: string | null): CountryCode[] {
  const list = (allowed ?? "IN")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(isCountryCode);
  return list.filter((c) => COUNTRIES[c].hasPack);
}
