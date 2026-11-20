/**
 * US federal payroll rules for 2026. Federal income tax withholding follows IRS Publication 15-T's
 * percentage method for Forms W-4 from 2020 on. Everything here must be checked against the IRS's
 * 2026 publications before the pack pays anyone (see golden/US.json).
 */
export const TAX_YEAR = 2026;

export const FILING_STATUSES = {
  single: "Single or married filing separately",
  married: "Married filing jointly",
  head: "Head of household",
} as const;
export type FilingStatus = keyof typeof FILING_STATUSES;

/** Standard deduction by filing status. */
export const STANDARD_DEDUCTION: Record<FilingStatus, number> = { single: 16100, married: 32200, head: 24150 };

/** Income tax brackets on taxable income (the top of each bracket). */
export const BRACKETS: Record<FilingStatus, { upTo: number; rate: number }[]> = {
  single: [
    { upTo: 12400, rate: 0.1 },
    { upTo: 50400, rate: 0.12 },
    { upTo: 105700, rate: 0.22 },
    { upTo: 201775, rate: 0.24 },
    { upTo: 256225, rate: 0.32 },
    { upTo: 640600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  married: [
    { upTo: 24800, rate: 0.1 },
    { upTo: 100800, rate: 0.12 },
    { upTo: 211400, rate: 0.22 },
    { upTo: 403550, rate: 0.24 },
    { upTo: 512450, rate: 0.32 },
    { upTo: 768700, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  head: [
    { upTo: 17700, rate: 0.1 },
    { upTo: 67450, rate: 0.12 },
    { upTo: 105700, rate: 0.22 },
    { upTo: 201750, rate: 0.24 },
    { upTo: 256200, rate: 0.32 },
    { upTo: 640600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
};

export const FICA = {
  socialSecurityRate: 0.062,
  socialSecurityWageBase: 184500,
  medicareRate: 0.0145,
  /** Withheld from the employee only, on wages over $200,000 in the year, whatever their filing status. */
  additionalMedicareRate: 0.009,
  additionalMedicareThreshold: 200000,
};

/** Federal unemployment: 6% less the 5.4% credit for paying state unemployment on time, on the first $7,000. */
export const FUTA = { rate: 0.006, wageBase: 7000 };

/** States with no income tax on wages. Every other state is the payroll partner's job for now. */
export const NO_WAGE_TAX_STATES = ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"];

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
/** A state's code from its code or name. */
export function stateCode(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.trim();
  if (US_STATES[v.toUpperCase()]) return v.toUpperCase();
  return Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === v.toLowerCase())?.[0] ?? null;
}

export const US_CONFIRM = "Check the 2026 brackets, standard deductions and Social Security wage base against IRS Publication 15-T and the SSA, and whether your state unemployment credit keeps FUTA at 0.6%.";
