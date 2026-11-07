import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Payment, PaymentBatch } from "@/lib/types";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/page";
import { PaymentActionDialog, type PaymentAction } from "@/components/payments/shared";
import { paymentActions, paymentColumns } from "./BatchDetail";
import { batchColumns } from "./Batches";

export default function Reconciliation() {
  const nav = useNavigate();
  const { can } = useSession();
  const att = useQuery({ queryKey: ["payments", "attention"], queryFn: () => api.get<Payment[]>("/admin/payments/attention") });
  const open = useQuery({ queryKey: ["payments", "batches", "all"], queryFn: () => api.get<PaymentBatch[]>("/admin/payments/batches") });
  const [action, setAction] = useState<{ a: PaymentAction; items: Payment[] } | null>(null);
  const pCols = useMemo(() => paymentColumns({ batch: true }), []);
  const bCols = useMemo(() => batchColumns(), []);
  const waiting = (open.data ?? []).filter((b) => b.status === "processing" || b.status === "approved" || b.status === "draft");
  const canEdit = can("payments", "edit");
  return (
    <>
      {att.error ? <ErrorState error={att.error} retry={() => att.refetch()} /> : null}
      <TableCard>
        <CardHeader title="Failed and held payments" sub="Retried payments reuse the original reference, so the bank rejects duplicates" />
        <DataTable
          data={att.data ?? []}
          columns={pCols}
          getRowId={(p) => p.id}
          loading={att.isFetching}
          storageKey="payments-attention"
          empty="Nothing failed or on hold"
          rowActions={(p) => paymentActions(p, canEdit, true, (a, items) => setAction({ a, items }))}
          bulkActions={canEdit ? [{ label: "Retry in next file", onRun: (sel) => setAction({ a: "pending", items: sel }) }] : undefined}
        />
      </TableCard>
      <TableCard>
        <CardHeader title="Batches to reconcile" sub="Drafts waiting for approval and files sent to the bank without a result yet" />
        <DataTable data={waiting} columns={bCols} getRowId={(b) => b.id} loading={open.isFetching} storageKey="payments-open" onRowClick={(b) => nav(`/payments/batches/${b.id}`)} empty="All batches are reconciled" columnToggle={false} />
      </TableCard>
      <PaymentActionDialog action={action?.a ?? null} items={action?.items ?? []} onClose={() => setAction(null)} />
    </>
  );
}
