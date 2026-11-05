import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, inr, todayIST } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, TableCard, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { ErrorState, Loading } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { monthLabel } from "@/components/payroll/Payslip";
import { RUN_STATUS_LABEL, RUN_STEP } from "@/components/payroll/PayrollCard";
import { usePayrollRuns, useStartCurrentRun } from "./PayrollLayout";

export const RUN_TONE: Record<string, Tone> = { draft: "neutral", calculated: "warn", approved: "accent", paid: "ok" };

export function StepBar({ step }: { step: number }) {
  return (
    <div className="grid grid-cols-7 gap-1" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="h-2 rounded-[var(--radius-md)]" style={{ background: i + 1 < step ? "var(--ok)" : i + 1 === step ? "var(--color-accent)" : "var(--tint-2)" }} />
      ))}
    </div>
  );
}

export default function Runs() {
  const { can } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const runs = usePayrollRuns();
  const start = useStartCurrentRun();
  const month = todayIST().slice(0, 7);
  const current = runs.data?.find((r) => r.month === month);

  const discard = useMutation({
    mutationFn: (id: string) => api.del(`/admin/payroll/runs/${id}`),
    onSuccess: () => {
      toast.success("Draft payroll discarded");
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const columns = useMemo<ColumnDef<PayrollRun>[]>(
    () => [
      { id: "month", header: "Month", accessorKey: "month", cell: ({ row }) => <span className="font-medium">{monthLabel(row.original.month)}</span> },
      { id: "employees", header: "Employees", accessorFn: (r) => r.totals?.employees ?? 0, meta: { align: "right" } },
      { id: "gross", header: "Gross", accessorFn: (r) => r.totals?.gross ?? 0, cell: ({ getValue }) => inr(getValue<number>()), meta: { align: "right" } },
      { id: "net", header: "Net pay", accessorFn: (r) => r.totals?.net ?? 0, cell: ({ getValue }) => <span className="font-semibold">{inr(getValue<number>())}</span>, meta: { align: "right" } },
      { id: "tds", header: "TDS", accessorFn: (r) => r.totals?.tds ?? 0, cell: ({ getValue }) => inr(getValue<number>()), meta: { align: "right" } },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <Tag tone={RUN_TONE[row.original.status]}>{RUN_STATUS_LABEL[row.original.status]}</Tag> },
      { id: "approved", header: "Approved by", accessorFn: (r) => r.approvedByName ?? "", cell: ({ row }) => row.original.approvedByName ?? "—" },
      { id: "paid", header: "Paid on", accessorFn: (r) => r.paidAt ?? "", cell: ({ row }) => (row.original.paidAt ? fmtDate(row.original.paidAt.slice(0, 10)) : "—") },
    ],
    [],
  );

  if (runs.isLoading) return <Loading />;
  if (runs.error) return <ErrorState error={runs.error} retry={() => runs.refetch()} />;
  const t = current?.totals;

  return (
    <>
      <Card className="!gap-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="card-kicker">{monthLabel(month)} payroll</div>
            <div className="stat-value mt-0.5">{t ? inr(t.net) : current ? "Not calculated yet" : "Not started"}</div>
            <div className="card-meta">
              {current && t ? `${t.employees} employees · net payable · pay date ${current.payDate ? fmtDate(current.payDate) : "not set"}` : current ? "Inputs are being prepared" : "Start the run to fetch salary structures and attendance"}
            </div>
          </div>
          {current ? <Tag tone={RUN_TONE[current.status]}>{current.status === "paid" ? "Paid" : `Step ${Math.min(RUN_STEP[current.status]!, 7)} of 7 · ${RUN_STATUS_LABEL[current.status]}`}</Tag> : null}
        </div>
        <StepBar step={current ? RUN_STEP[current.status]! : 1} />
        {t ? (
          <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <Fig label="Gross earnings" v={t.gross} />
            <Fig label="Deductions" v={t.deductions} />
            <Fig label="Employer contributions" v={t.employerCost} />
            <Fig label="Cost to company" v={t.ctc} />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {current ? (
            <Button variant="primary" onClick={() => nav(`/payroll/run/${current.id}`)}>
              {current.status === "paid" ? "View run" : "Continue payroll run"}
            </Button>
          ) : can("payroll", "edit") ? (
            <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
              Start {monthLabel(month).split(" ")[0]} payroll
            </Button>
          ) : (
            <span className="text-muted text-[13px]">A payroll admin hasn't started this month's run yet.</span>
          )}
          {current && (current.status === "draft" || current.status === "calculated") && can("payroll", "edit") ? (
            <Button variant="danger" loading={discard.isPending} onClick={() => confirm(`Discard the ${monthLabel(current.month)} payroll? Adjustments and overrides will be lost.`) && discard.mutate(current.id)}>
              Discard draft
            </Button>
          ) : null}
        </div>
      </Card>

      <TableCard>
        <CardHeader className="py-2" title="Payroll history" sub="Every run for this company. Click a month to open it." />
        <DataTable
          data={runs.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => nav(`/payroll/run/${r.id}`)}
          storageKey="payroll-runs"
          pageSize={12}
          empty="No payroll runs yet"
          rowActions={(r) => [
            { label: "Open", onSelect: () => nav(`/payroll/run/${r.id}`) },
            ...((r.status === "draft" || r.status === "calculated") && can("payroll", "edit")
              ? [{ label: "Discard draft", danger: true, onSelect: () => confirm(`Discard the ${monthLabel(r.month)} payroll?`) && discard.mutate(r.id) }]
              : []),
          ]}
        />
      </TableCard>
    </>
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
