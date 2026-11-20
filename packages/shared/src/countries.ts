/**
 * Countries Saralix plans to support. A country is only usable for a legal entity when it
 * has a country pack (`hasPack`) and the instance allows it (ALLOWED_COUNTRIES). See docs/MULTI_COUNTRY.md.
 */
export const COUNTRY_CODES = ["IN", "AE", "SA", "QA", "KW", "OM", "BH", "GB", "US", "CA"] as const;
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
  AE: { code: "AE", name: "United Arab Emirates", currency: "AED", decimals: 2, timeZone: "Asia/Dubai", timeZones: ["Asia/Dubai"], weekend: [0, 6], hasPack: true },
  SA: { code: "SA", name: "Saudi Arabia", currency: "SAR", decimals: 2, timeZone: "Asia/Riyadh", timeZones: ["Asia/Riyadh"], weekend: [5, 6], hasPack: true },
  QA: { code: "QA", name: "Qatar", currency: "QAR", decimals: 2, timeZone: "Asia/Qatar", timeZones: ["Asia/Qatar"], weekend: [5, 6], hasPack: true },
  KW: { code: "KW", name: "Kuwait", currency: "KWD", decimals: 3, timeZone: "Asia/Kuwait", timeZones: ["Asia/Kuwait"], weekend: [5, 6], hasPack: true },
  OM: { code: "OM", name: "Oman", currency: "OMR", decimals: 3, timeZone: "Asia/Muscat", timeZones: ["Asia/Muscat"], weekend: [5, 6], hasPack: true },
  BH: { code: "BH", name: "Bahrain", currency: "BHD", decimals: 3, timeZone: "Asia/Bahrain", timeZones: ["Asia/Bahrain"], weekend: [5, 6], hasPack: true },
  GB: { code: "GB", name: "United Kingdom", currency: "GBP", decimals: 2, timeZone: "Europe/London", timeZones: ["Europe/London"], weekend: [0, 6], hasPack: true },
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
  CA: {
    code: "CA",
    name: "Canada",
    currency: "CAD",
    decimals: 2,
    timeZone: "America/Toronto",
    timeZones: ["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "America/St_Johns", "America/Regina"],
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

/** Every ISO 3166 country code, for nationality. Names come from Intl.DisplayNames in the browser. */
export const ISO_COUNTRIES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW"
).split(" ");

/** A country's name in English, falling back to the code. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
