import { COUNTRIES } from "../../countries";
import type { CountryPack } from "../types";
import { uaeStatutory } from "./payroll";
import { uaeSettlement } from "./settlement";

export const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];

/** United Arab Emirates: no income tax, GPSSA or ADPF for nationals, gratuity under the 2021 Labour Law, WPS. */
export const uaePack: CountryPack = {
  code: "AE",
  info: COUNTRIES.AE,
  review: {
    status: "pending",
    note: "Built from UAE law, but not yet checked by a UAE payroll expert. Run payroll alongside your current system until golden/AE.json is signed off.",
  },
  payroll: {
    statutory: uaeStatutory,
    componentLabels: { hra: "Housing allowance", conveyance: "Transport allowance", medical: "Medical allowance", special: "Other allowance" },
    roundingDecimals: 2,
    amountInWords: (n) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  },
  settlement: (i) => uaeSettlement(i),
  // fixed date holidays; Eid al Fitr, Arafat Day, Eid al Adha, Hijri New Year and the Prophet's birthday move with the moon
  publicHolidays: (y) => [
    { date: `${y}-01-01`, name: "New Year's Day", type: "national" },
    { date: `${y}-12-01`, name: "Commemoration Day", type: "national" },
    { date: `${y}-12-02`, name: "National Day", type: "national" },
    { date: `${y}-12-03`, name: "National Day holiday", type: "national" },
  ],
  regions: { label: "Emirate", list: EMIRATES },
  entityRegistrations: [
    { key: "tradeLicence", label: "Trade licence number" },
    { key: "mohreId", label: "MOHRE establishment ID" },
    { key: "trn", label: "TRN (VAT)" },
    { key: "wpsRoutingCode", label: "Bank routing code for WPS" },
  ],
  ruleCategories: ["gpssa", "adpf"],
};
