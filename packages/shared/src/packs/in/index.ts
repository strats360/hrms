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
    { key: "epfCode", label: "EPF establishment code" },
    { key: "esiCode", label: "ESI employer code" },
    { key: "shopsRegistration", label: "Shops and Establishments registration" },
    { key: "labourCodeRegistration", label: "Labour Code (OSH) registration" },
    { key: "ptRegistration", label: "Professional tax registration" },
    { key: "lwfRegistration", label: "Labour welfare fund registration" },
    { key: "contractLabourLicence", label: "Contract labour licence (50+ contract workers)" },
  ],
  ruleCategories: ["pf", "esi", "pt", "lwf", "tax", "minwage"],
};

import { z } from "zod";
/** India payroll details kept per employee: disability (higher ESI limit, PT exemption) and overtime consent. */
export const indiaPayrollProfileSchema = z.object({
  disability: z.boolean().default(false),
  /** Written consent to work overtime (OSH Code). */
  overtimeConsent: z.boolean().default(false),
  /** Voluntary PF on top of the 12%, as a % of PF wages (counts for 80C in the old regime). */
  vpfPercent: z.coerce.number().min(0).max(88).default(0),
  /** The employer's NPS contribution, as a % of basic plus DA (80CCD(2)). */
  npsEmployerPercent: z.coerce.number().min(0).max(20).default(0),
  /** A company car used partly for personal travel: small is up to 1.6 litres or electric. */
  car: z.enum(["none", "small", "large"]).default("none"),
  driver: z.boolean().default(false),
});
