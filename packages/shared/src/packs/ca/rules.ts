/**
 * Canadian payroll rules for 2026, following CRA's payroll deductions formulas (T4127).
 * Every figure must be checked against CRA's and Revenu Québec's January 2026 tables before the
 * pack pays anyone (see golden/CA.json).
 */
export const TAX_YEAR = 2026;

export interface Bracket {
  upTo: number;
  rate: number;
}

export const FEDERAL = {
  brackets: [
    { upTo: 58523, rate: 0.14 },
    { upTo: 117045, rate: 0.205 },
    { upTo: 181440, rate: 0.26 },
    { upTo: 258482, rate: 0.29 },
    { upTo: Infinity, rate: 0.33 },
  ] as Bracket[],
  /** Credits are worth the lowest rate. */
  creditRate: 0.14,
  /** Basic personal amount: the full amount, reduced to the minimum between the 4th and 5th bracket thresholds. */
  bpaMax: 16452,
  bpaMin: 14829,
  /** Canada employment amount. */
  employmentAmount: 1501,
  /** Quebec residents get 16.5% off basic federal tax. */
  quebecAbatement: 0.165,
};

export const CPP = {
  rate: 0.0595,
  /** The base part of the rate, which counts as a credit; the enhanced part (1%) is a deduction from income. */
  baseRate: 0.0495,
  exemption: 3500,
  ympe: 74600,
  /** CPP2: 4% on earnings between the YMPE and the YAMPE. */
  rate2: 0.04,
  yampe: 85000,
};
/** Quebec Pension Plan in place of CPP. */
export const QPP = { rate: 0.064, baseRate: 0.054, exemption: 3500, ympe: CPP.ympe, rate2: 0.04, yampe: CPP.yampe };

export const EI = {
  rate: 0.0163,
  quebecRate: 0.013,
  maxInsurable: 68900,
  /** The employer pays 1.4 times the employee's premium. */
  employerFactor: 1.4,
};
/** Quebec Parental Insurance Plan. */
export const QPIP = { rate: 0.00494, employerRate: 0.00692, maxInsurable: 103000 };

/** Ontario: brackets, the basic personal amount and the surtax. */
export const ONTARIO = {
  brackets: [
    { upTo: 53891, rate: 0.0505 },
    { upTo: 107785, rate: 0.0915 },
    { upTo: 150000, rate: 0.1116 },
    { upTo: 220000, rate: 0.1216 },
    { upTo: Infinity, rate: 0.1316 },
  ] as Bracket[],
  creditRate: 0.0505,
  bpa: 12989,
  surtax: [
    { over: 5818, rate: 0.2 },
    { over: 7446, rate: 0.36 },
  ],
};

export const PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia",
  NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
export function provinceCode(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.trim();
  if (PROVINCES[v.toUpperCase()]) return v.toUpperCase();
  return Object.entries(PROVINCES).find(([, name]) => name.toLowerCase() === v.toLowerCase())?.[0] ?? null;
}

export const CA_CONFIRM = "Check every 2026 figure against CRA's T4127 (January 2026) and Revenu Québec's TP-1015.F: federal and Ontario brackets, basic personal amounts, YMPE and YAMPE, EI and QPIP rates and maximums.";
