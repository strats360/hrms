import { COUNTRIES } from "../../countries";
import { computeSettlement } from "../../fnf";
import { rupeesInWords } from "../../payroll";
import type { CountryPack } from "../types";
import { indiaStatutory } from "./payroll";

/** India: EPF, ESI, PT, LWF, TDS and Form 16, gratuity under the Payment of Gratuity Act. */
export const indiaPack: CountryPack = {
  code: "IN",
  info: COUNTRIES.IN,
  payroll: {
    statutory: indiaStatutory,
    roundingDecimals: 0,
    amountInWords: (n) => rupeesInWords(n),
  },
  settlement: (i) => computeSettlement(i),
  entityRegistrations: [
    { key: "gstin", label: "GSTIN" },
    { key: "pan", label: "PAN" },
    { key: "tan", label: "TAN" },
    { key: "cin", label: "CIN or LLPIN" },
  ],
  ruleCategories: ["pf", "esi", "pt", "lwf", "tax", "minwage"],
};
