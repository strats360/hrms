import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { inr, todayIST } from "@hrms/shared";
import { api } from "@/lib/api";
import type { PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { monthLabel } from "./Payslip";

export const RUN_STEP: Record<string, number> = { draft: 2, calculated: 5, approved: 7, paid: 8 };
export const RUN_STATUS_LABEL: Record<string, string> = { draft: "Draft · inputs", calculated: "Calculated · in review", approved: "Approved & locked", paid: "Paid" };

/** Dashboard card: this month's payroll at a glance (design: "Current month payroll"). */
export function PayrollCard() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["payroll", "runs"], queryFn: () => api.get<PayrollRun[]>("/admin/payroll/runs") });
  const month = todayIST().slice(0, 7);
  const runs = q.data ?? [];
  const current = runs.find((r) => r.month === month);
  const last = runs.find((r) => r.status === "paid");
  const shown = current ?? last;
  const step = current ? RUN_STEP[current.status]! : 0;
  const t = shown?.totals;
  return (
    <Card className="!gap-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="card-kicker">{current ? "Current month payroll" : last ? "Last payroll" : "Payroll"}</div>
          <div className="stat-value mt-0.5">{t ? inr(t.net) : "Not started"}</div>
          <div className="card-meta">{shown && t ? `${t.employees} employees · net payable · ${monthLabel(shown.month)}` : `${monthLabel(month)} payroll hasn't been started`}</div>
        </div>
        {current ? <Tag tone={current.status === "paid" ? "ok" : "warn"}>{current.status === "paid" ? "Paid" : `Step ${Math.min(step, 7)} of 7 · ${RUN_STATUS_LABEL[current.status]}`}</Tag> : last ? <Tag tone="ok">Paid</Tag> : null}
      </div>
      <div className="grid grid-cols-7 gap-1" aria-hidden>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-2 rounded-[var(--radius-md)]" style={{ background: i + 1 < step ? "var(--ok)" : i + 1 === step ? "var(--color-accent)" : "var(--tint-2)" }} />
        ))}
      </div>
      {t ? (
        <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
          <Fig label="Gross earnings" v={t.gross} />
          <Fig label="Deductions" v={t.deductions} />
          <Fig label="Employer contributions" v={t.employerCost} />
          <Fig label="TDS" v={t.tds} />
        </div>
      ) : null}
      <div className="mt-1 flex gap-2">
        <Button variant="primary" onClick={() => nav(current ? `/payroll/run/${current.id}` : "/payroll")}>
          {current ? (current.status === "paid" ? "View payroll" : "Continue payroll run") : `Run ${monthLabel(month).split(" ")[0]} payroll`}
        </Button>
        <Button variant="ghost" onClick={() => nav("/payroll/payslips")}>
          Payslips
        </Button>
      </div>
    </Card>
  );
}

function Fig({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="text-muted text-[11.5px]">{label}</div>
      <div className="num font-semibold">{inr(v)}</div>
    </div>
  );
}
