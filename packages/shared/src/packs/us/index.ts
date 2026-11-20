import { COUNTRIES } from "../../countries";
import type { CountryPack } from "../types";
import { usFederalHolidays } from "./holidays";
import { usStatutory } from "./payroll";
import { US_STATES } from "./rules";
import { usSettlement } from "./settlement";

/** United States: federal withholding, FICA and FUTA here; state taxes through a payroll partner. */
export const usPack: CountryPack = {
  code: "US",
  info: COUNTRIES.US,
  review: {
    status: "pending",
    note: "Federal withholding, Social Security, Medicare and FUTA are built from IRS Publication 15-T for 2026, but not yet checked by a US payroll professional. State income tax, state unemployment and tax filings need a payroll partner. Run payroll alongside your current provider until golden/US.json is signed off.",
  },
  payroll: {
    statutory: usStatutory,
    componentLabels: { basic: "Salary" },
    salaryTemplate: { basicPctOfGross: 100, hraPctOfBasic: 0, conveyance: 0, medical: 0, pfOnFullBasic: false },
    roundingDecimals: 2,
    amountInWords: (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    taxYearStartMonth: 1,
    payFrequencies: ["monthly", "semi_monthly", "biweekly", "weekly"],
  },
  settlement: usSettlement,
  publicHolidays: usFederalHolidays,
  regions: { label: "Work state", list: Object.values(US_STATES) },
  entityRegistrations: [
    { key: "ein", label: "Employer Identification Number (EIN)" },
    { key: "stateWithholdingId", label: "State withholding account" },
    { key: "suiAccount", label: "State unemployment (SUI) account" },
  ],
  ruleCategories: ["federal"],
};
