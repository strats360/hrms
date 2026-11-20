import { COUNTRIES } from "../../countries";
import type { CountryPack } from "../types";
import { saudiStatutory } from "./payroll";
import { saudiSettlement } from "./settlement";

export const SAUDI_REGIONS = ["Riyadh", "Makkah", "Madinah", "Eastern Province", "Qassim", "Asir", "Tabuk", "Hail", "Northern Borders", "Jazan", "Najran", "Al Bahah", "Al Jawf"];

/** Saudi Arabia: no income tax, GOSI, the end of service award under the Labor Law, Mudad wage protection. */
export const saudiPack: CountryPack = {
  code: "SA",
  info: COUNTRIES.SA,
  review: {
    status: "pending",
    note: "Built from Saudi law, but not yet checked by a Saudi payroll expert. Run payroll alongside your current system until golden/SA.json is signed off.",
  },
  payroll: {
    statutory: saudiStatutory,
    componentLabels: { hra: "Housing allowance", conveyance: "Transport allowance", medical: "Medical allowance", special: "Other allowance" },
    roundingDecimals: 2,
    amountInWords: (n) => `SAR ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  },
  settlement: (i) => saudiSettlement(i),
  // fixed date holidays; Eid al Fitr and Eid al Adha move with the moon
  publicHolidays: (y) => [
    { date: `${y}-02-22`, name: "Founding Day", type: "national" },
    { date: `${y}-09-23`, name: "National Day", type: "national" },
  ],
  regions: { label: "Region", list: SAUDI_REGIONS },
  entityRegistrations: [
    { key: "crNumber", label: "Commercial registration (CR)" },
    { key: "unifiedNumber", label: "Unified number (700)" },
    { key: "mhrsdId", label: "MHRSD establishment number" },
    { key: "gosiNumber", label: "GOSI registration number" },
    { key: "vatNumber", label: "VAT number" },
  ],
  ruleCategories: ["gosi"],
};
