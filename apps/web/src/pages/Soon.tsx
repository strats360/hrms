import { useLocation } from "react-router";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

const INFO: Record<string, [string, string, string[]]> = {
  payroll: ["Payroll", "Monthly payroll runs with salary structures, LOP from approved attendance, payslips and bank files.", ["Salary structure templates (Basic, HRA, allowances, employer contributions)", "7-step payroll wizard: inputs, attendance and LOP, calculate, review, approve and lock, payslips, bank file", "Payslip PDFs and the salary register"]],
  compliance: ["Statutory compliance", "EPF, EPS, EDLI, ESI, PT, LWF, gratuity, bonus and minimum wages, with challans and due dates.", ["Employee-wise and employer-wise contributions", "ECR, ESI and PT returns", "Challan tracking with due-date alerts"]],
  tds: ["TDS & income tax", "Declarations, regime choice, projections, monthly TDS and Form 16.", ["Old and new regime computation", "Investment proofs", "24Q and Form 16"]],
  reimbursements: ["Reimbursements", "Claims with receipts, GST details, manager and finance approval, and payouts.", ["Claim submission from self-service", "Two-level approval", "Payout through payment batches"]],
  payments: ["Payments", "Salary, reimbursement and bonus payment batches with bank file formats and reconciliation.", ["Bank-specific CSV/Excel formats", "Duplicate payment checks", "Failed transfer handling"]],
  reports: ["Reports", "Filterable registers with CSV and Excel export.", ["Employee master, attendance and leave registers are already exportable from their pages", "Payroll, compliance and cost reports arrive with payroll"]],
};

/** Placeholder for modules planned in later phases. */
export default function Soon() {
  const key = useLocation().pathname.split("/").filter(Boolean).pop() ?? "";
  const [title, sub, items] = INFO[key] ?? ["Coming soon", "This part of the product is planned for a later phase.", []];
  return (
    <>
      <PageHeader title={title} sub={sub} />
      <Card className="max-w-[720px] !gap-3">
        <div className="flex items-center gap-2">
          <Tag tone="accent">Planned for phase 2</Tag>
        </div>
        <div className="text-[14px]">This module is designed and will be built in the next phase. What it will include:</div>
        <ul className="!m-0 flex flex-col gap-1.5 pl-5 text-[14px]">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
