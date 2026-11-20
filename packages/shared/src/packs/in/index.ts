import { COUNTRIES } from "../../countries";
import { computeSettlement } from "../../fnf";
import { rupeesInWords } from "../../payroll";
import type { CountryPack } from "../types";
import { indiaStatutory } from "./payroll";

/** India: EPF, ESI, PT, LWF, TDS and Form 16, gratuity under the Payment of Gratuity Act. */
export const indiaPack: CountryPack = {
  code: "IN",
  info: COUNTRIES.IN,
  review: { status: "pending", note: "India's figures are locked by golden/IN.json, waiting for a payroll consultant's sign off." },
  regions: { label: "State", list: [] },
  payroll: {
    statutory: indiaStatutory,
    roundingDecimals: 0,
    amountInWords: (n) => rupeesInWords(n),
  },
  settlement: (i) => computeSettlement(i),
  publicHolidays: (y) => [
    { date: `${y}-01-26`, name: "Republic Day", type: "national" },
    { date: `${y}-08-15`, name: "Independence Day", type: "national" },
    { date: `${y}-10-02`, name: "Gandhi Jayanti", type: "national" },
  ],
  entityRegistrations: [
    { key: "gstin", label: "GSTIN" },
    { key: "pan", label: "PAN" },
    { key: "tan", label: "TAN" },
    { key: "cin", label: "CIN or LLPIN" },
  ],
  ruleCategories: ["pf", "esi", "pt", "lwf", "tax", "minwage"],
};

import { z } from "zod";
/** India payroll details kept per employee: a person with disability has a higher ESI limit (₹25,000). */
export const indiaPayrollProfileSchema = z.object({ disability: z.boolean().default(false) });
