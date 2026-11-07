import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, inr } from "@hrms/shared";
import { api } from "@/lib/api";
import type { PaymentBatch, PaymentType } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { BatchStatusTag } from "@/components/payments/shared";

export function batchColumns(): ColumnDef<PaymentBatch, any>[] {
  return [
    { id: "code", header: "Batch", accessorFn: (b) => b.code, cell: ({ getValue }) => <span className="font-semibold">{getValue<string>()}</span> },
    { id: "label", header: "Description", accessorFn: (b) => b.label },
    { id: "count", header: "Payments", accessorFn: (b) => b.count, meta: { align: "right" } },
    { id: "amount", header: "Amount", accessorFn: (b) => b.amount, meta: { align: "right" }, cell: ({ getValue }) => <span className="font-semibold">{inr(getValue<number>())}</span> },
    { id: "bank", header: "Bank account", accessorFn: (b) => b.bank ?? "", cell: ({ row: { original: b } }) => <div>{b.bank ?? "—"}<div className="text-muted text-[11.5px]">{b.formatLabel}</div></div> },
    { id: "date", header: "Date", accessorFn: (b) => b.paymentDate, cell: ({ getValue }) => fmtDate(getValue<string>()) },
    {
      id: "status",
      header: "Status",
      accessorFn: (b) => b.status,
      cell: ({ row: { original: b } }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <BatchStatusTag status={b.status} />
          {b.failed ? <Tag tone="bad">{b.failed} failed</Tag> : null}
          {b.held ? <Tag>{b.held} held</Tag> : null}
        </div>
      ),
    },
  ];
}

export default function Batches({ type }: { type: PaymentType }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["payments", "batches", type], queryFn: () => api.get<PaymentBatch[]>(`/admin/payments/batches?type=${type}`) });
  const columns = useMemo(() => batchColumns(), []);
  return (
    <>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={q.data ?? []}
          columns={columns}
          getRowId={(b) => b.id}
          loading={q.isFetching}
          storageKey={`payments-${type}`}
          onRowClick={(b) => nav(`/payments/batches/${b.id}`)}
          rowActions={(b) => [{ label: "Open batch", onSelect: () => nav(`/payments/batches/${b.id}`) }]}
          empty={type === "salary" ? "No salary batches yet. Lock a payroll month, then generate a batch." : type === "reimbursement" ? "No reimbursement batches. Approved claims are paid with payroll unless you pay them here first." : "No batches yet"}
        />
      </TableCard>
    </>
  );
}
