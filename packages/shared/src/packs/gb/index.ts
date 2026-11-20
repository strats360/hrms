import { COUNTRIES } from "../../countries";
import type { CountryPack } from "../types";
import { englandBankHolidays } from "./holidays";
import { ukStatutory } from "./payroll";
import { ukSettlement } from "./settlement";

/** United Kingdom: PAYE, National Insurance, student loans and pension auto enrolment. */
export const ukPack: CountryPack = {
  code: "GB",
  info: COUNTRIES.GB,
  review: {
    status: "pending",
    note: "Built from HMRC's rules for 2026/27, but not yet checked by a UK payroll professional, and Saralix can't file RTI to HMRC yet. Run payroll alongside your current software until golden/GB.json is signed off.",
  },
  payroll: {
    statutory: ukStatutory,
    componentLabels: { basic: "Salary" },
    // one salary line: UK pay isn't split into allowances
    salaryTemplate: { basicPctOfGross: 100, hraPctOfBasic: 0, conveyance: 0, medical: 0, pfOnFullBasic: false },
    roundingDecimals: 2,
    amountInWords: (n) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  },
  settlement: ukSettlement,
  publicHolidays: englandBankHolidays,
  regions: { label: "Nation", list: ["England", "Wales", "Scotland", "Northern Ireland"] },
  entityRegistrations: [
    { key: "companyNumber", label: "Companies House number" },
    { key: "payeReference", label: "Employer PAYE reference (123/AB45678)" },
    { key: "accountsOfficeReference", label: "Accounts Office reference" },
    { key: "vatNumber", label: "VAT number" },
  ],
  ruleCategories: ["paye", "ni"],
};
