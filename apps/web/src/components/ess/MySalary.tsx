import { Link } from "react-router";
import { fmtDate, inr } from "@hrms/shared";
import { useSession } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty } from "@/components/ui/page";

interface Line {
  code: string;
  label: string;
  amount: number;
}
export interface MySalaryData {
  effectiveFrom: string | null;
  annualCtc: number;
  monthlyCtc: number;
  earnings: Line[];
  gross: number;
  employer: Line[];
  employerTotal: number;
  deductions: Line[];
  totalDeductions: number;
  takeHome: number;
  regime: "old" | "new";
  revisions: { effectiveFrom: string; annualCtc: number; change: number | null; changePct: number | null }[];
}

/** The employee's own salary structure: CTC breakdown, estimated take-home and revisions. */
export function MySalary({ data: d }: { data: MySalaryData }) {
  const { has } = useSession();
  if (!d.annualCtc) {
    return (
      <Card>
        <Empty title="No salary on record yet" sub="HR hasn't set up your salary in the system. Ask them if you think this is wrong." />
      </Card>
    );
  }
  return (
    <>
      <div className="card" style={{ padding: 20, background: "var(--ok-bg)", color: "var(--ok-fg)" }}>
        <div className="text-[11px] uppercase tracking-[0.1em]">Cost to company{d.effectiveFrom ? ` · since ${fmtDate(d.effectiveFrom)}` : ""}</div>
        <div className="num text-[32px] font-medium leading-tight">
          {inr(d.annualCtc)}
          <span className="text-[14px] font-normal"> a year</span>
        </div>
        <div className="text-[12.5px]">{inr(d.monthlyCtc)} a month</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="!gap-1">
          <div className="text-muted text-[12px]">Monthly gross</div>
          <div className="num text-[22px] font-medium">{inr(d.gross)}</div>
          <div className="text-muted text-[12px]">Everything you earn before deductions</div>
        </Card>
        <Card className="!gap-1">
          <div className="text-muted text-[12px]">Estimated take-home</div>
          <div className="num text-[22px] font-medium">{inr(d.takeHome)}</div>
          <div className="text-muted text-[12px]">A full month with no unpaid leave</div>
        </Card>
      </div>

      <Card className="!gap-2">
        <CardHeader title="Salary breakdown" sub="What makes up your CTC. Employer contributions are part of your CTC but go to your PF or ESI account, not your bank." />
        <div className="scroll-thin min-w-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Component</th>
                <th className="text-right">Monthly</th>
                <th className="text-right">Yearly</th>
              </tr>
            </thead>
            <tbody>
              {d.earnings.map((l) => (
                <Row key={l.code} label={l.label} amount={l.amount} />
              ))}
              <Row label="Gross salary" amount={d.gross} strong />
              {d.employer.map((l) => (
                <Row key={l.code} label={l.label} amount={l.amount} />
              ))}
              <Row label="Cost to company" amount={d.monthlyCtc} strong />
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="!gap-2">
        <CardHeader title="Estimated deductions" sub={`Income tax is worked out under the ${d.regime} tax regime, from what's been paid so far this year. Your payslip has the exact figures each month.`} />
        <div className="flex flex-col divide-y divide-[var(--color-divider)] text-[13.5px]">
          {d.deductions.map((l) => (
            <div key={l.code} className="flex justify-between gap-3 py-2">
              <span>{l.label}</span>
              <span className="num">{inr(l.amount)}</span>
            </div>
          ))}
          {!d.deductions.length ? <div className="text-muted py-2">No deductions.</div> : null}
          <div className="flex justify-between gap-3 py-2 font-semibold">
            <span>Estimated take-home</span>
            <span className="num">{inr(d.takeHome)}</span>
          </div>
        </div>
        {has("module.tds") ? (
          <div className="text-muted text-[12.5px]">
            Lower your tax by declaring investments and rent in <Link to="/me/tax">Tax</Link>.
          </div>
        ) : null}
      </Card>

      <Card className="!gap-2">
        <CardHeader title="Salary revisions" />
        {d.revisions.length ? (
          <div className="flex flex-col divide-y divide-[var(--color-divider)] text-[13.5px]">
            {d.revisions.map((r) => (
              <div key={r.effectiveFrom} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="font-medium">From {fmtDate(r.effectiveFrom)}</div>
                  {r.change !== null ? (
                    <div className="text-[12px]" style={{ color: r.change >= 0 ? "var(--ok-fg)" : "var(--bad)" }}>
                      {r.change >= 0 ? "+" : "−"}
                      {inr(Math.abs(r.change))} ({r.changePct !== null ? `${r.changePct >= 0 ? "+" : ""}${r.changePct}%` : ""})
                    </div>
                  ) : (
                    <div className="text-muted text-[12px]">First recorded</div>
                  )}
                </div>
                <span className="num font-semibold">{inr(r.annualCtc)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted text-[13px]">No revisions recorded yet.</div>
        )}
      </Card>
    </>
  );
}

function Row({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <tr className={strong ? "font-semibold" : undefined}>
      <td>{label}</td>
      <td className="num text-right">{inr(amount)}</td>
      <td className="num text-right">{inr(amount * 12)}</td>
    </tr>
  );
}
