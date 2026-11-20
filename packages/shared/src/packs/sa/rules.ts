/**
 * Saudi rules as data, with where each figure comes from. Everything marked `confirm` must be
 * checked by a Saudi payroll expert before the pack is used for real pay (see golden/SA.json).
 */

/** GOSI contribution wage limits, SAR a month: basic wage plus housing allowance. */
export const GOSI_WAGE = { min: 1500, max: 45000 };

/** The new Social Insurance Law's start: people first insured on or after this date are "new participants". */
export const GOSI_NEW_LAW_FROM = "2024-07-03";

/** Annuities (pension) for Saudis insured before the new law: 9% each side. */
export const ANNUITY_EXISTING = 0.09;

/**
 * Annuities for new participants: 9% each side, rising half a point every July from 2025 until
 * it reaches 11% in July 2028.
 */
export const ANNUITY_NEW_STEPS: { from: string; rate: number }[] = [
  { from: "2024-07-03", rate: 0.09 },
  { from: "2025-07-01", rate: 0.095 },
  { from: "2026-07-01", rate: 0.1 },
  { from: "2027-07-01", rate: 0.105 },
  { from: "2028-07-01", rate: 0.11 },
];

/** SANED unemployment insurance, Saudis only: 0.75% each side. */
export const SANED = 0.0075;

/** Occupational hazards: 2% from the employer, for everyone, Saudi or not. */
export const HAZARDS = 0.02;

export const GOSI_SOURCE = "Social Insurance Law (Royal Decree M/33 of 1421H) and the new Social Insurance Law effective 3 July 2024";
export const GOSI_CONFIRM = "The annuity steps for new participants, whether SANED still applies at these rates, and which allowances count in the contribution wage.";

/** Other GCC states: their nationals in Saudi Arabia pay into their home scheme (GCC unified insurance extension). */
export const GCC_OTHERS = ["AE", "KW", "QA", "OM", "BH"];

/** End of service award, Saudi Labor Law (Royal Decree M/51 of 1426H), Articles 84 and 85. */
export const EOSB = {
  /** Half a month's wage for each of the first five years, a full month's for each year after. */
  monthsPerYearFirstFive: 0.5,
  monthsPerYearAfter: 1,
  /** On resignation (Article 85): nothing under 2 years, a third from 2 to 5, two thirds from 5 to 10, all of it from 10. */
  resignationShare: [
    { minYears: 10, share: 1 },
    { minYears: 5, share: 2 / 3 },
    { minYears: 2, share: 1 / 3 },
    { minYears: 0, share: 0 },
  ],
  source: "Saudi Labor Law, Articles 84, 85 and 87",
  confirm: "The award is on the last actual wage: basic plus housing and other regular allowances. Check which allowances your contracts include.",
};

/**
 * Saudization (Nitaqat) counts a Saudi employee in full only when paid at least SAR 4,000 a month;
 * between 3,000 and 4,000 counts as half. Bands depend on the company's activity and size, so
 * the app shows the share and leaves the band to Qiwa.
 */
export const NITAQAT = { fullCountWage: 4000, halfCountWage: 3000 };
export const NITAQAT_CONFIRM = "Nitaqat bands depend on your activity and size, and some people count more (Saudis with disabilities) or less (part time). Check your band in Qiwa.";
