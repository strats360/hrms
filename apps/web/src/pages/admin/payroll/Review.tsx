import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download, Lock } from "lucide-react";
import { inr } from "@hrms/shared";
import { api, download, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Lookups, PayrollItem, PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Segmented, Select } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { PayslipDialog } from "@/components/payroll/PayslipDialog";
import { monthLabel } from "@/components/payroll/Payslip";
import { RUN_STATUS_LABEL } from "@/components/payroll/PayrollCard";
import { AdjustmentDialog, HoldDialog, LopDialog } from "@/components/payroll/review/dialogs";

type Filter = "all" | "exceptions" | "lop" | "hold";

/** Rupee figure sized to fit a stat tile (crore amounts are long). */
function Money({ v }: { v: number }) {
  return <span className="text-[24px]">{inr(v)}</span>;
}

function change(item: PayrollItem) {
  if (item.previousNet == null || item.previousNet === 0) return null;
  return ((item.net - item.previousNet) / item.previousNet) * 100;
}

export default function Review() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [department, setDepartment] = useState("");
  const [filter, setFilter] = useState<Filter>(() => (["all", "exceptions", "lop", "hold"].includes(params.get("filter") ?? "") ? (params.get("filter") as Filter) : "all"));
  const [slip, setSlip] = useState<string | null>(null);
  const [hold, setHold] = useState<PayrollItem[] | null>(null);
  const [lop, setLop] = useState<PayrollItem | null>(null);
  const [adj, setAdj] = useState<PayrollItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const runs = useQuery({ queryKey: ["payroll", "runs"], queryFn: () => api.get<PayrollRun[]>("/admin/payroll/runs") });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/admin/org/lookups") });
  const reviewable = useMemo(() => (runs.data ?? []).filter((r) => r.status !== "draft"), [runs.data]);
  const runId = params.get("run") ?? reviewable[0]?.id ?? null;
  const run = runs.data?.find((r) => r.id === runId) ?? null;

  const items = useQuery({
    queryKey: ["payroll", "items", runId, term, department, filter],
    queryFn: () => api.get<PayrollItem[]>(`/admin/payroll/runs/${runId}/items${qs({ q: term, department, filter })}`),
    enabled: !!runId && run?.status !== "draft",
  });

  const editable = run?.status === "calculated" && can("payroll", "edit");
  const release = useMutation({
    mutationFn: async (list: PayrollItem[]) => {
      for (const it of list) await api.patch(`/admin/payroll/runs/${runId}/items/${it.employeeId}`, { onHold: false, holdReason: null });
    },
    onSuccess: (_d, list) => {
      toast.success(list.length === 1 ? `Salary released for ${list[0]!.snapshot.name}` : `${list.length} salaries released`);
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const columns = useMemo<ColumnDef<PayrollItem>[]>(
    () => [
      {
        id: "name",
        header: "Employee",
        accessorFn: (r) => r.snapshot.name,
        cell: ({ row: { original: r } }) => (
          <div>
            <div className="font-medium">{r.snapshot.name}</div>
            <div className="text-muted text-[12px]">
              {r.snapshot.code}
              {r.snapshot.department ? ` · ${r.snapshot.department}` : ""}
            </div>
          </div>
        ),
      },
      {
        id: "paid",
        header: "Paid days",
        accessorFn: (r) => r.paidDays,
        cell: ({ row: { original: r } }) => {
          const l = r.lopOverride ?? r.lopDays;
          return (
            <div className="flex items-center gap-1.5">
              <span>
                {r.paidDays} / {r.daysInMonth}
              </span>
              {l > 0 ? <Tag tone="warn" title={r.lopOverride != null ? `Set manually (attendance: ${r.lopDays})` : "From attendance"}>{l} LOP{r.lopOverride != null ? "*" : ""}</Tag> : null}
            </div>
          );
        },
      },
      { id: "gross", header: "Gross", accessorFn: (r) => r.gross, meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "deductions", header: "Deductions", accessorFn: (r) => r.totalDeductions, meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "tds", header: "TDS", accessorFn: (r) => r.tds, meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "claims", header: "Claims", accessorFn: (r) => Number(r.reimbursement ?? 0), meta: { align: "right" }, cell: ({ getValue }) => (getValue<number>() ? inr(getValue<number>()) : <span className="text-muted">—</span>) },
      { id: "employer", header: "Employer", accessorFn: (r) => r.employerCost, meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "net", header: "Net", accessorFn: (r) => r.net, meta: { align: "right" }, cell: ({ getValue }) => <span className="font-semibold">{inr(getValue<number>())}</span> },
      {
        id: "change",
        header: "vs last month",
        accessorFn: (r) => change(r) ?? -Infinity,
        meta: { align: "right" },
        cell: ({ row: { original: r } }) => {
          const c = change(r);
          if (c === null) return <span className="text-muted">New</span>;
          const text = `${c > 0 ? "+" : ""}${c.toFixed(1)}%`;
          return Math.abs(c) > 20 ? <Tag tone="warn" title={`Last month ${inr(r.previousNet!)}`}>{text}</Tag> : <span className="text-muted" title={`Last month ${inr(r.previousNet!)}`}>{text}</span>;
        },
      },
      { id: "ctc", header: "CTC", accessorFn: (r) => r.gross + r.employerCost, meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => (r.onHold ? 2 : r.warnings.length ? 1 : 0),
        cell: ({ row: { original: r } }) => (
          <div className="flex flex-wrap gap-1">
            {r.onHold ? <Tag tone="bad" title={r.holdReason ?? undefined}>On hold</Tag> : null}
            {r.warnings.length ? <Tag tone="warn" title={r.warnings.join("\n")}>{r.warnings.length} {r.warnings.length === 1 ? "check" : "checks"}</Tag> : null}
            {r.adjustments.length ? <Tag tone="accent" title={r.adjustments.map((a) => `${a.label} ${inr(a.amount)}`).join("\n")}>{r.adjustments.length} one-time</Tag> : null}
            {!r.onHold && !r.warnings.length && !r.adjustments.length ? <Tag tone="ok">OK</Tag> : null}
          </div>
        ),
      },
    ],
    [],
  );

  if (runs.isLoading) return <Loading />;
  if (runs.error) return <ErrorState error={runs.error} retry={() => runs.refetch()} />;
  if (!reviewable.length || !run)
    return (
      <Empty
        title="Nothing to review yet"
        sub="Start this month's payroll and run the calculation. The register appears here."
        action={
          <Link to="/payroll" className="btn btn-primary self-start no-underline">
            Go to payroll runs
          </Link>
        }
      />
    );

  const t = run.totals;
  const depts = lookups.data?.departments ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Select className="!w-[230px]" value={run.id} onChange={(e) => setParams({ run: e.target.value })} aria-label="Payroll month">
          {reviewable.map((r) => (
            <option key={r.id} value={r.id}>
              {monthLabel(r.month)} · {RUN_STATUS_LABEL[r.status]}
            </option>
          ))}
        </Select>
        {can("payroll", "export") ? (
          <Button className="ml-auto" onClick={() => download(`/admin/payroll/runs/${run.id}/register.csv`, `salary-register-${run.month}.csv`).catch((e) => toast.error(e.message))}>
            <Download size={16} /> Export register
          </Button>
        ) : null}
      </div>

      {t ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))" }}>
          <StatCard label="Gross earnings" value={<Money v={t.gross} />} meta={`${t.employees} employees`} />
          <StatCard label="Total deductions" value={<Money v={t.deductions} />} meta={`PF ${inr(t.pfEmployee)} · PT ${inr(t.pt)}`} />
          <StatCard label="Employer contributions" value={<Money v={t.employerCost} />} meta={`PF ${inr(t.pfEmployer)} · ESI ${inr(t.esiEmployer)}`} />
          <StatCard label="TDS" value={<Money v={t.tds} />} meta="Income tax this month" />
          <StatCard label="Net salary" value={<Money v={t.net} />} meta={t.onHold ? <Tag tone="bad">{t.onHold} on hold</Tag> : t.reimbursement ? `Includes ${inr(t.reimbursement)} claims` : "Payable to employees"} className="!shadow-[inset_0_0_0_1px_var(--color-accent)]" />
          <StatCard label="Cost to company" value={<Money v={t.ctc} />} meta={`${t.withLop} with LOP · ${t.lopDays} days`} />
        </div>
      ) : null}

      {run.status === "calculated" ? (
        <Notice tone="sel">
          Review the register, hold salaries or add one-time pay. When it looks right, <Link to={`/payroll/run/${run.id}`}>approve and lock it in the run wizard</Link>.
        </Notice>
      ) : (
        <Notice tone="ok">
          <span className="inline-flex items-center gap-1.5">
            <Lock size={14} /> {monthLabel(run.month)} is {run.status === "paid" ? "paid" : "approved and locked"}
            {run.approvedByName ? ` by ${run.approvedByName}` : ""}. Changes go into next month as arrears or recoveries.
          </span>
        </Notice>
      )}

      <TableCard>
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="card-title text-[17px]">
            {monthLabel(run.month)} · {items.data?.length ?? 0} {filter === "all" && !term && !department ? "employees" : "shown"}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="!w-[220px]" placeholder="Search name or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />
            <Select className="!w-[180px]" value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
              <option value="">All departments</option>
              {depts.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "exceptions", label: "Exceptions" },
                { value: "lop", label: "With LOP" },
                { value: "hold", label: "On hold" },
              ]}
            />
          </div>
        </div>
        {items.error ? (
          <ErrorState error={items.error} retry={() => items.refetch()} />
        ) : (
          <DataTable
            data={items.data ?? []}
            loading={items.isLoading || items.isFetching}
            columns={columns}
            getRowId={(r) => r.employeeId}
            pageSize={15}
            storageKey="payroll-review"
            onRowClick={(r) => setSlip(r.employeeId)}
            empty={filter === "all" ? "No employees in this run" : "No employees match this filter"}
            rowActions={(r) => [
              { label: "View payslip", onSelect: () => setSlip(r.employeeId) },
              ...(editable
                ? [
                    r.onHold ? { label: "Release salary", onSelect: () => release.mutate([r]) } : { label: "Hold salary", onSelect: () => setHold([r]) },
                    { label: "Set LOP days", onSelect: () => setLop(r) },
                    { label: r.adjustments.length ? "Earnings & deductions" : "Add earning or deduction", onSelect: () => setAdj(r) },
                  ]
                : []),
            ]}
            bulkActions={
              editable
                ? [
                    { label: "Hold selected", onRun: (rows) => setHold(rows.filter((x) => !x.onHold)) },
                    { label: "Release selected", onRun: (rows) => release.mutateAsync(rows.filter((x) => x.onHold)) },
                  ]
                : undefined
            }
          />
        )}
      </TableCard>

      <PayslipDialog runId={slip ? run.id : null} employeeId={slip} onClose={() => setSlip(null)} />
      <HoldDialog runId={run.id} items={hold} onClose={() => setHold(null)} />
      <LopDialog runId={run.id} item={lop} onClose={() => setLop(null)} />
      <AdjustmentDialog runId={run.id} item={adj} onClose={() => setAdj(null)} />
    </>
  );
}
