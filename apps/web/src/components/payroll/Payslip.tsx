import { fmtDate, inr, rupeesInWords } from "@hrms/shared";
import type { PayLine, PayslipView } from "@/lib/types";
import { Tag } from "@/components/ui/tag";

export function monthLabel(month: string) {
  return new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

function Lines({ title, lines, total, totalLabel }: { title: string; lines: PayLine[]; total: number; totalLabel: string }) {
  return (
    <div>
      <div className="card-kicker mb-1.5">{title}</div>
      <div className="flex flex-col">
        {lines.map((l) => (
          <div key={l.code} className="flex justify-between py-[5px]">
            <span>{l.label}</span>
            <span className="num">{inr(l.amount)}</span>
          </div>
        ))}
        {lines.length === 0 ? <div className="text-muted py-[5px]">None</div> : null}
        <div className="flex justify-between border-t border-[var(--color-divider)] py-2 font-bold">
          <span>{totalLabel}</span>
          <span className="num">{inr(total)}</span>
        </div>
      </div>
    </div>
  );
}

/** Payslip layout from the design. Wrap in an element with id="payslip-print" to print just the slip. */
export function Payslip({ slip }: { slip: PayslipView }) {
  const e = slip.employee;
  const erPf = slip.employer.filter((l) => l.code === "epf_er" || l.code === "eps").reduce((s, l) => s + l.amount, 0);
  const erEsi = slip.employer.find((l) => l.code === "esi_er")?.amount ?? 0;
  return (
    <div className="payslip flex flex-col gap-4 text-[13.5px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[22px] font-medium">{slip.company.legalName ?? slip.company.name}</div>
          <div className="text-muted text-[12.5px]">{[slip.company.address, slip.company.pan && `PAN ${slip.company.pan}`, slip.company.tan && `TAN ${slip.company.tan}`].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right">
          <div className="card-kicker">Payslip</div>
          <div className="font-semibold">{monthLabel(slip.run.month)}</div>
          {slip.onHold ? <Tag tone="warn">Salary on hold</Tag> : null}
        </div>
      </div>
      <div className="grid gap-2.5 rounded-[var(--radius-md)] px-3.5 py-3 text-[12.5px] sm:grid-cols-4" style={{ background: "var(--tint-1)" }}>
        <Info label="Employee" value={e.name} bold />
        <Info label="ID · Designation" value={[e.code, e.designation].filter(Boolean).join(" · ")} />
        <Info label="PAN · UAN" value={`${e.pan ?? "—"} · ${e.uan ?? "—"}`} />
        <Info label="Bank" value={e.bankName ? `${e.bankName} · ····${e.accountLast4 ?? ""}` : "—"} />
        <Info label="Date of joining" value={fmtDate(e.dateOfJoining)} />
        <Info label="Paid days" value={`${slip.paidDays} / ${slip.daysInMonth}`} />
        <Info label="LOP days" value={String(slip.lopDays)} />
        <Info label="Location" value={e.branch ?? "—"} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Lines title="Earnings" lines={slip.earnings} total={slip.gross} totalLabel="Gross earnings" />
        <Lines title="Deductions" lines={slip.deductions} total={slip.totalDeductions} totalLabel="Total deductions" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-4 py-3.5" style={{ background: "var(--ok-bg)", color: "var(--ok-fg)" }}>
        <div>
          <div className="text-[12px]">Net pay</div>
          <div className="text-[26px] font-medium num">{inr(slip.net)}</div>
          <div className="text-[12px]">{rupeesInWords(slip.net)}</div>
          {slip.reimbursement ? <div className="mt-1 text-[12px]">Includes reimbursements of {inr(slip.reimbursement)} (not taxable)</div> : null}
        </div>
        <div className="text-right text-[12.5px]">
          <div>
            Employer PF {inr(erPf)}
            {erEsi ? ` · Employer ESI ${inr(erEsi)}` : ""}
          </div>
          <div>Monthly cost to company {inr(slip.gross + slip.employerCost)}</div>
          {slip.tax ? <div>Projected annual taxable income {inr(slip.tax.taxableIncome)} · {e.regime === "old" ? "Old" : "New"} regime</div> : null}
        </div>
      </div>
      <div className="text-muted text-[11.5px]">This is a computer-generated payslip and does not need a signature. Pay date {slip.run.payDate ? fmtDate(slip.run.payDate) : "—"}.</div>
    </div>
  );
}

function Info({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-muted">{label}</div>
      <div className={bold ? "font-semibold" : undefined}>{value}</div>
    </div>
  );
}

/** Print only the payslip (styles in app.css under #payslip-print). */
export function printPayslip() {
  window.print();
}
