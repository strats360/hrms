import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { inr, inrCompact } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { monthLabel } from "@/components/payroll/Payslip";
import { DECL_STATUS_LABEL, DECL_STATUS_TONE, useFy } from "./shared";

export interface SummaryRow {
  employeeId: string;
  name: string;
  code: string;
  pan: string | null;
  regime: "new" | "old";
  declarationStatus: string;
  declared80C: number;
  declaredTotal: number;
  taxableIncome: number;
  annualTax: number;
  monthlyTds: number;
  deducted: number;
  remaining: number;
}
export interface SummaryResp {
  fy: string;
  lastMonth: string | null;
  totals: { monthlyTds: number; deducted: number; newRegime: number; oldRegime: number; submitted: number; pending: number; nilTax: number };
  rows: SummaryRow[];
}

export const useTdsSummary = (fy: string) => useQuery({ queryKey: ["tds", "summary", fy], queryFn: () => api.get<SummaryResp>(`/admin/tds/summary${qs({ fy })}`) });

const money = (k: keyof SummaryRow, header: string): ColumnDef<SummaryRow> => ({ id: k, header, accessorKey: k, meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) });

export default function Summary() {
  const fy = useFy();
  const nav = useNavigate();
  const q = useTdsSummary(fy);
  const [search, setSearch] = useState("");
  const [regime, setRegime] = useState("");
  const [status, setStatus] = useState("");
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.rows ?? []).filter(
      (r) => (!s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || (r.pan ?? "").toLowerCase().includes(s)) && (!regime || r.regime === regime) && (!status || r.declarationStatus === status),
    );
  }, [q.data, search, regime, status]);
  const cols = useMemo<ColumnDef<SummaryRow>[]>(
    () => [
      { id: "name", header: "Employee", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-muted text-[12px]">{r.code} · {r.pan ?? "No PAN"}</div></div> },
      { id: "regime", header: "Regime", accessorKey: "regime", cell: ({ getValue }) => <Tag tone={getValue<string>() === "old" ? "warn" : "neutral"}>{getValue<string>() === "old" ? "Old" : "New"}</Tag> },
      { id: "declared", header: "Declared", accessorKey: "declaredTotal", meta: { align: "right" }, cell: ({ row: { original: r } }) => <div>{inr(r.declaredTotal)}{r.declared80C ? <div className="text-muted text-[11.5px]">80C {inrCompact(r.declared80C)}</div> : null}</div> },
      money("taxableIncome", "Taxable income"),
      money("annualTax", "Annual tax"),
      money("monthlyTds", "Monthly TDS"),
      money("deducted", "Deducted YTD"),
      money("remaining", "Remaining"),
      { id: "status", header: "Declaration", accessorKey: "declarationStatus", cell: ({ getValue }) => <Tag tone={DECL_STATUS_TONE[getValue<string>()] ?? "neutral"}>{DECL_STATUS_LABEL[getValue<string>()] ?? getValue<string>()}</Tag> },
    ],
    [],
  );
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const t = q.data!.totals;
  const last = q.data!.lastMonth;
  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))" }}>
        <StatCard label={`Monthly TDS${last ? ` (${monthLabel(last).split(" ")[0].slice(0, 3)})` : ""}`} value={inrCompact(t.monthlyTds)} meta={last ? `${monthLabel(last)} payroll` : "No locked payroll yet"} />
        <StatCard label="Deducted YTD" value={inrCompact(t.deducted)} meta="From locked payroll" />
        <StatCard label="Regime split" value={`${t.newRegime} / ${t.oldRegime}`} meta="new / old" />
        <StatCard label="Declarations" value={t.submitted} meta={t.pending ? <Tag tone="warn">{t.pending} pending</Tag> : "All submitted"} />
        <StatCard label="Nil-tax employees" value={t.nilTax} meta="Rebate u/s 87A or below the limit" />
      </div>
      <TableCard>
        <div className="flex flex-wrap items-center gap-2 py-2">
          <Input className="!w-[240px]" placeholder="Search name, ID or PAN" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <Select className="!w-[150px]" value={regime} onChange={(e) => setRegime(e.target.value)} aria-label="Regime">
            <option value="">All regimes</option>
            <option value="new">New regime</option>
            <option value="old">Old regime</option>
          </Select>
          <Select className="!w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Declaration status">
            <option value="">All declarations</option>
            <option value="not_started">Not started</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="verified">Verified</option>
          </Select>
          <span className="text-muted ml-auto text-[12.5px]">Click an employee for the full tax computation</span>
        </div>
        <DataTable data={rows} columns={cols} getRowId={(r) => r.employeeId} pageSize={15} storageKey="tds-summary" onRowClick={(r) => nav(`/tds/compute${qs({ employee: r.employeeId, fy })}`)} />
      </TableCard>
    </>
  );
}
