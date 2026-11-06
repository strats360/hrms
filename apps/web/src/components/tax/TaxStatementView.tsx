import { inr } from "@hrms/shared";
import type { TaxStatement } from "@/lib/types";

const pct = (r: number) => `${Math.round(r * 100)}%`;
const range = (from: number, to: number | null) => (to === null ? `Above ${inr(from)}` : `${inr(from)} – ${inr(to)}`);

function Row({ label, value, minus, bold, muted }: { label: React.ReactNode; value: number; minus?: boolean; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${bold ? "border-t border-[var(--color-divider)] pt-2 font-semibold" : ""}`} style={muted ? { color: "var(--muted)" } : undefined}>
      <span>{label}</span>
      <span className="num whitespace-nowrap">
        {minus && value ? "– " : ""}
        {inr(Math.abs(value))}
      </span>
    </div>
  );
}

/** The income-tax computation statement (Form 16 Part B style). Printable inside #payslip-print. */
export function TaxStatementView({ s, compact }: { s: TaxStatement; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3 text-[13.5px]">
      <div>
        <div className="card-kicker mb-1">Income</div>
        <Row label="Gross salary (incl. previous employer)" value={s.grossSalary} />
        {s.exemptions.map((e) => (
          <Row key={e.key} label={e.label} value={e.amount} minus />
        ))}
        <Row label={`Standard deduction u/s 16(ia)`} value={s.standardDeduction} minus />
        {s.regime === "old" ? <Row label="Professional tax u/s 16(iii)" value={s.professionalTax} minus /> : null}
        <Row label="Income from salary" value={s.incomeFromSalary} bold />
        {s.houseProperty ? <Row label="Loss from house property (home loan interest 24(b))" value={s.houseProperty} minus /> : null}
        {s.otherIncome ? <Row label="Income from other sources" value={s.otherIncome} /> : null}
        <Row label="Gross total income" value={s.grossTotalIncome} bold />
      </div>
      {s.deductions.length ? (
        <div>
          <div className="card-kicker mb-1">Deductions under Chapter VI-A</div>
          {s.deductions.map((d) => (
            <Row key={d.key} label={d.label} value={d.amount} minus />
          ))}
          <Row label="Total deductions" value={s.totalDeductions} minus bold />
        </div>
      ) : s.regime === "new" ? (
        <div className="text-muted text-[12.5px]">New regime (s.115BAC): Chapter VI-A deductions, HRA exemption and professional tax aren't allowed.</div>
      ) : null}
      <div className="rounded-[var(--radius-md)] px-3.5 py-2.5" style={{ background: "var(--tint-1)" }}>
        <Row label="Taxable income (rounded to ₹10)" value={s.taxableIncome} />
      </div>
      {!compact ? (
        <div className="scroll-thin min-w-0 overflow-x-auto">
          <table className="table text-[13px]">
            <thead>
              <tr>
                <th>Slab</th>
                <th>Rate</th>
                <th style={{ textAlign: "right" }}>Income in slab</th>
                <th style={{ textAlign: "right" }}>Tax</th>
              </tr>
            </thead>
            <tbody>
              {s.slabs.map((sl) => (
                <tr key={sl.from}>
                  <td className="whitespace-nowrap">{range(sl.from, sl.to)}</td>
                  <td>{pct(sl.rate)}</td>
                  <td className="num text-right">{inr(sl.amount)}</td>
                  <td className="num text-right">{inr(sl.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div>
        <Row label="Tax on total income" value={s.tax.baseTax} />
        {s.tax.rebate ? <Row label="Rebate u/s 87A" value={s.tax.rebate} minus /> : null}
        {s.tax.surcharge ? <Row label="Surcharge" value={s.tax.surcharge} /> : null}
        <Row label="Health & education cess 4%" value={s.tax.cess} />
        <Row label="Tax payable for the year" value={s.tax.total} bold />
        {s.previousEmployerTds ? <Row label="TDS by previous employer" value={s.previousEmployerTds} minus muted /> : null}
      </div>
    </div>
  );
}
