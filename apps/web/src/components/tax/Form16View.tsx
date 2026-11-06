import { fmtDate, inr } from "@hrms/shared";
import type { Form16Data } from "@/lib/types";
import { Tag } from "@/components/ui/tag";
import { TaxStatementView } from "./TaxStatementView";
import { monthLabel } from "@/components/payroll/Payslip";

/**
 * Form 16 (certificate u/s 203). Part A summary from our records plus Part B
 * (the salary statement). Wrap in #payslip-print to print / save as PDF.
 */
export function Form16View({ f }: { f: Form16Data }) {
  const totalDeducted = f.quarters.reduce((s, q) => s + q.tdsDeducted, 0);
  const totalDeposited = f.quarters.reduce((s, q) => s + q.tdsDeposited, 0);
  return (
    <div className="flex flex-col gap-4 text-[13.5px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="card-kicker">Form No. 16 · certificate under section 203</div>
          <div className="text-[20px] font-medium">Tax deducted at source on salary</div>
          <div className="text-muted text-[12.5px]">
            Financial year {f.fy} · Assessment year {f.assessmentYear}
            {f.period.from ? ` · ${monthLabel(f.period.from)} to ${monthLabel(f.period.to!)}` : ""}
          </div>
        </div>
        {f.provisional ? <Tag tone="warn">Provisional · year not closed</Tag> : <Tag tone="ok">Final</Tag>}
      </div>
      <div className="grid gap-3 rounded-[var(--radius-md)] px-3.5 py-3 text-[12.5px] sm:grid-cols-2" style={{ background: "var(--tint-1)" }}>
        <div>
          <div className="text-muted">Employer (deductor)</div>
          <div className="font-semibold">{f.employer.name}</div>
          <div>{f.employer.address}</div>
          <div>
            PAN {f.employer.pan ?? "—"} · TAN {f.employer.tan ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-muted">Employee (deductee)</div>
          <div className="font-semibold">{f.employee.name}</div>
          <div>
            {f.employee.code} · PAN {f.employee.pan ?? "Not available"}
          </div>
          <div>Opted for new regime u/s 115BAC: {f.employee.regime === "new" ? "Yes" : "No"}</div>
        </div>
      </div>

      <div>
        <div className="card-title mb-1 text-[15px]">Part A · Summary of tax deducted and deposited</div>
        <div className="scroll-thin min-w-0 overflow-x-auto">
          <table className="table text-[13px]">
            <thead>
              <tr>
                <th>Quarter</th>
                <th>Return receipt no.</th>
                <th style={{ textAlign: "right" }}>Amount paid / credited</th>
                <th style={{ textAlign: "right" }}>Tax deducted</th>
                <th style={{ textAlign: "right" }}>Tax deposited</th>
              </tr>
            </thead>
            <tbody>
              {f.quarters.map((q) => (
                <tr key={q.quarter}>
                  <td>{q.quarter}</td>
                  <td>{q.receipt ?? "—"}</td>
                  <td className="num text-right">{inr(q.amountPaid)}</td>
                  <td className="num text-right">{inr(q.tdsDeducted)}</td>
                  <td className="num text-right">{inr(q.tdsDeposited)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold" colSpan={3}>
                  Total
                </td>
                <td className="num text-right font-semibold">{inr(totalDeducted)}</td>
                <td className="num text-right font-semibold">{inr(totalDeposited)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {f.challans.length ? (
          <div className="text-muted mt-1 text-[12px]">
            Challans: {f.challans.map((c) => `${monthLabel(c.period)} ${c.reference ?? ""} (${fmtDate(c.paidOn)})`).join(" · ")}
          </div>
        ) : null}
        <div className="text-muted mt-1 text-[12px]">The official Part A with the TRACES certificate number is downloaded from TRACES after the Q4 return is processed.</div>
      </div>

      <div>
        <div className="card-title mb-1 text-[15px]">Part B · Details of salary paid and tax deducted</div>
        <TaxStatementView s={f.statement} compact />
        <div className="mt-2 flex justify-between border-t border-[var(--color-divider)] pt-2 font-semibold">
          <span>Tax deducted at source by this employer</span>
          <span className="num">{inr(f.tdsDeducted)}</span>
        </div>
      </div>
      <div className="text-muted text-[11.5px]">
        Verification: certified that the information above is true and correct based on the books of account and documents available with the employer. To be signed by the person responsible for deduction of tax.
      </div>
    </div>
  );
}
