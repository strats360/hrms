/**
 * UAE rules as data, with where each figure comes from. Everything marked `confirm` must be
 * checked by a UAE payroll expert before the pack is used for real pay (see golden/AE.json).
 */

/** National pension contributions for UAE nationals, as shares of the contribution salary. */
export interface PensionRule {
  name: string;
  employeeRate: number;
  employerRate: number;
  /** Paid by the government, not through payroll; shown for information. */
  governmentRate: number;
  /** Monthly contribution salary limits, AED. */
  minSalary: number;
  maxSalary: number;
  source: string;
  confirm: string | null;
}

/** GPSSA, for private sector employers outside Abu Dhabi (Federal Decree-Law No. 57 of 2023, from 31 Oct 2023). */
export const GPSSA: PensionRule = {
  name: "GPSSA pension",
  employeeRate: 0.11,
  employerRate: 0.125,
  governmentRate: 0.025,
  minSalary: 1000,
  maxSalary: 70000,
  source: "Federal Decree-Law No. 57 of 2023 on Pensions and Social Security Benefits",
  confirm: "Rates for people insured before 31 Oct 2023, the salary limits, and which allowances count as contribution salary.",
};

/** Abu Dhabi Pension Fund, for UAE nationals working for Abu Dhabi employers (Law No. 2 of 2000, as amended). */
export const ADPF: PensionRule = {
  name: "ADPF pension",
  employeeRate: 0.05,
  employerRate: 0.15,
  governmentRate: 0,
  minSalary: 0,
  maxSalary: 100000,
  source: "Abu Dhabi Law No. 2 of 2000 on Civil Retirement Pensions and Benefits",
  confirm: "All rates and limits: Abu Dhabi has revised them, check the current ones.",
};

/** Other GCC states: their nationals in the UAE pay into their home scheme (GCC unified insurance extension). */
export const GCC_OTHERS = ["SA", "KW", "QA", "OM", "BH"];

/** End of service gratuity, Federal Decree-Law No. 33 of 2021 (Labour Law), Article 51. */
export const GRATUITY = {
  minServiceDays: 365,
  daysPerYearFirstFive: 21,
  daysPerYearAfter: 30,
  /** The daily basic wage is the monthly basic over 30. */
  dayDivisor: 30,
  /** The total can't be more than two years' basic wage. */
  capMonths: 24,
  source: "Federal Decree-Law No. 33 of 2021, Article 51",
};

/**
 * Emiratisation targets for private companies with 50 or more employees: the share of skilled
 * jobs held by UAE nationals by each date (2% a year, met 1% each half year).
 * MOHRE Ministerial Resolution No. 279 of 2022 and its 2023 update.
 */
export const EMIRATISATION_TARGETS: { by: string; share: number }[] = [
  { by: "2023-12-31", share: 0.04 },
  { by: "2024-06-30", share: 0.05 },
  { by: "2024-12-31", share: 0.06 },
  { by: "2025-06-30", share: 0.07 },
  { by: "2025-12-31", share: 0.08 },
  { by: "2026-06-30", share: 0.09 },
  { by: "2026-12-31", share: 0.1 },
];
export const EMIRATISATION_MIN_EMPLOYEES = 50;
export const EMIRATISATION_CONFIRM = "Targets apply to skilled roles only, and companies with 20 to 49 employees in some sectors have their own rule (one national a year). Check MOHRE's current targets and penalties.";
