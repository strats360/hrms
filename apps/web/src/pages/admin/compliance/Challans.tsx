import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, fyOfMonth, inr, todayIST } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Obligation } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Segmented, Select } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";
import { monthLabel } from "@/components/payroll/Payslip";
import { ObligationTag } from "@/components/compliance/shared";
import { RecordPaymentDialog } from "@/components/compliance/RecordPaymentDialog";

type Filter = "all" | "open" | "paid";

export default function Challans() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const currentFy = fyOfMonth(todayIST().slice(0, 7));
  const fy = params.get("fy") ?? currentFy;
  const status = (params.get("status") as Filter) ?? "all";
  const [statute, setStatute] = useState("");
  const [paying, setPaying] = useState<Obligation | null>(null);
  const q = useQuery({ queryKey: ["compliance", "obligations", fy], queryFn: () => api.get<{ fy: string; rows: Obligation[] }>(`/admin/compliance/obligations${qs({ fy })}`) });
  const rows = useMemo(
    () => (q.data?.rows ?? []).filter((o) => (!statute || o.statute === statute) && (status === "all" || (status === "paid" ? o.status === "paid" : o.status !== "paid"))),
    [q.data, statute, status],
  );
  const canEdit = can("compliance", "edit");
  const y = Number(currentFy.slice(0, 4));
  const cols = useMemo<ColumnDef<Obligation>[]>(
    () => [
      { id: "label", header: "Statute", accessorKey: "label", cell: ({ getValue }) => <span className="font-semibold">{getValue<string>()}</span> },
      { id: "period", header: "Period", accessorKey: "period", cell: ({ getValue }) => monthLabel(getValue<string>()) },
      { id: "amount", header: "Amount", accessorKey: "amount", meta: { align: "right" }, cell: ({ row: { original: o } }) => <div>{inr(o.challan?.amountPaid ?? o.amount)}{o.challan && o.challan.amountPaid !== o.amount ? <div className="text-muted text-[11.5px]">liability {inr(o.amount)}</div> : null}</div> },
      { id: "due", header: "Due", accessorKey: "dueDate", cell: ({ getValue }) => fmtDate(getValue<string>()) },
      { id: "ref", header: "Challan / TRRN", accessorFn: (o) => o.challan?.reference ?? "", cell: ({ row: { original: o } }) => <span className="text-muted text-[12.5px]">{o.challan?.reference ?? "—"}</span> },
      { id: "paidOn", header: "Paid on", accessorFn: (o) => o.challan?.paidOn ?? "", cell: ({ row: { original: o } }) => (o.challan ? fmtDate(o.challan.paidOn) : "—") },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: o } }) => <ObligationTag o={o} /> },
    ],
    [],
  );
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p);
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Select className="!w-[170px]" value={fy} onChange={(e) => set("fy", e.target.value)} aria-label="Financial year">
          {[y, y - 1, y - 2].map((s) => {
            const label = `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
            return (
              <option key={label} value={label}>
                FY {label}
              </option>
            );
          })}
        </Select>
        <Select className="!w-[200px]" value={statute} onChange={(e) => setStatute(e.target.value)} aria-label="Statute">
          <option value="">All statutes</option>
          <option value="epf">EPF</option>
          <option value="esi">ESI</option>
          <option value="pt">Professional Tax</option>
          <option value="lwf">LWF</option>
          <option value="tds">TDS</option>
        </Select>
        <Segmented<Filter> value={status} onChange={(v) => set("status", v === "all" ? "" : v)} options={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "paid", label: "Paid" }]} />
      </div>
      <TableCard>
        <DataTable
          data={rows}
          columns={cols}
          getRowId={(o) => o.key}
          pageSize={15}
          storageKey="compliance-challans"
          empty="No statutory liabilities for this filter"
          onRowClick={canEdit ? (o) => setPaying(o) : undefined}
          rowActions={(o) => [
            ...(canEdit ? [{ label: o.challan ? "Edit payment" : "Record payment", onSelect: () => setPaying(o) }] : []),
            ...(o.challan?.receiptName ? [{ label: "View receipt", onSelect: () => window.open(`/api/admin/compliance/challans/${o.challan!.id}/receipt`, "_blank", "noopener") }] : []),
          ]}
        />
      </TableCard>
      <RecordPaymentDialog obligation={paying} onClose={() => setPaying(null)} />
    </>
  );
}
