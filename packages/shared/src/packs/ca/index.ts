import { COUNTRIES } from "../../countries";
import type { CountryPack } from "../types";
import { ontarioHolidays } from "./holidays";
import { canadaStatutory } from "./payroll";
import { PROVINCES } from "./rules";
import { canadaSettlement } from "./settlement";

/** Canada: federal and Ontario tax, CPP or QPP, EI and QPIP here; other provinces through a payroll partner. */
export const canadaPack: CountryPack = {
  code: "CA",
  info: COUNTRIES.CA,
  review: {
    status: "pending",
    note: "Federal and Ontario income tax, CPP, CPP2, EI and QPIP are built from CRA's T4127 for 2026, but not yet checked by a Canadian payroll professional. Other provinces' tax, remittances, T4s and ROEs need a payroll partner. Run payroll alongside your current provider until golden/CA.json is signed off.",
  },
  payroll: {
    statutory: canadaStatutory,
    componentLabels: { basic: "Salary" },
    salaryTemplate: { basicPctOfGross: 100, hraPctOfBasic: 0, conveyance: 0, medical: 0, pfOnFullBasic: false },
    roundingDecimals: 2,
    amountInWords: (n) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD`,
    taxYearStartMonth: 1,
    payFrequencies: ["monthly", "semi_monthly", "biweekly", "weekly"],
  },
  settlement: canadaSettlement,
  publicHolidays: ontarioHolidays,
  regions: { label: "Province of employment", list: Object.values(PROVINCES) },
  entityRegistrations: [
    { key: "businessNumber", label: "Business number (BN)" },
    { key: "payrollAccount", label: "Payroll program account (RP)" },
    { key: "rqAccount", label: "Revenu Québec account (Quebec only)" },
  ],
  ruleCategories: ["federal", "provincial"],
};
