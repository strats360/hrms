import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inr } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Claim, ClaimSummary } from "@/lib/types";
import { StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Segmented } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/page";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { ClaimDetailDialog } from "@/components/reimbursements/shared";
import { claimColumns } from "./columns";

type F = "mine" | "pending_manager" | "pending_finance" | "all";
type Result = { done: number; errors: { id: string; message: string }[] };

export default function Queue() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<F>("mine");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [reject, setReject] = useState<string[] | null>(null);
  const summary = useQuery({ queryKey: ["claims", "summary"], queryFn: () => api.get<ClaimSummary>("/admin/reimbursements/summary") });
  const list = useQuery({
    queryKey: ["claims", "queue", filter],
    queryFn: () => api.get<Claim[]>(`/admin/reimbursements/claims${qs(filter === "mine" ? { mine: 1 } : { status: filter === "all" ? "pending_manager,pending_finance" : filter })}`),
  });
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list.data ?? []).filter((r) => !t || `${r.code} ${r.employeeName} ${r.employeeCode} ${r.category} ${r.project ?? ""}`.toLowerCase().includes(t));
  }, [list.data, q]);
  const canApprove = can("reimbursements", "approve");
  const decide = useMutation({
    mutationFn: (v: { ids: string[]; decision: "approved" | "rejected"; note?: string }) => api.post<Result>("/admin/reimbursements/claims/bulk-decision", { ids: v.ids, decision: v.decision, note: v.note || null }),
    onSuccess: (r, v) => {
      if (r.errors.length) toast.error(`${r.done} updated, ${r.errors.length} skipped: ${r.errors[0]!.message}`);
      else toast.success(`${r.done} claim${r.done === 1 ? "" : "s"} ${v.decision}`);
      qc.invalidateQueries({ queryKey: ["claims"] });
    },
  });
  const columns = useMemo(() => claimColumns({ gst: false }), []);
  const s = summary.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <StatCard label="Awaiting approval" value={s ? inr(s.pending.amount) : "—"} meta={s ? `${s.pending.count} claim${s.pending.count === 1 ? "" : "s"} · ${s.withManager} with managers, ${s.withFinance} with finance` : undefined} onClick={() => setFilter("all")} />
        <StatCard label="Approved, unpaid" value={s ? inr(s.approvedUnpaid.amount) : "—"} meta={s ? `${s.approvedUnpaid.count} claim${s.approvedUnpaid.count === 1 ? "" : "s"} · paid with next payroll` : undefined} />
        <StatCard label="Paid this month" value={s ? inr(s.paidThisMonth.amount) : "—"} meta={s ? `${s.paidThisMonth.count} claim${s.paidThisMonth.count === 1 ? "" : "s"} with salary` : undefined} />
        <StatCard label="GST input credit" value={s ? inr(s.gstCredit) : "—"} meta="this FY, on claims with GSTIN" />
      </div>
      {list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          loading={list.isFetching}
          storageKey="claims-queue"
          onRowClick={(r) => setOpen(r.id)}
          empty={filter === "mine" ? "No claims waiting for you" : "No claims waiting for approval"}
          bulkActions={
            canApprove && filter === "mine"
              ? [
                  { label: "Approve", onRun: (sel) => decide.mutateAsync({ ids: sel.map((x) => x.id), decision: "approved" }).then(() => undefined) },
                  { label: "Reject", onRun: (sel) => setReject(sel.map((x) => x.id)) },
                ]
              : undefined
          }
          rowActions={(r) => [
            { label: "View details", onSelect: () => setOpen(r.id) },
            ...(canApprove && filter === "mine"
              ? [
                  { label: "Approve", onSelect: () => decide.mutate({ ids: [r.id], decision: "approved" }) },
                  { label: "Reject", danger: true, onSelect: () => setReject([r.id]) },
                ]
              : []),
          ]}
          toolbar={
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search claim, employee or project" className="!w-[250px]" aria-label="Search" />
              <Segmented<F>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "mine", label: "Waiting for me" },
                  { value: "pending_manager", label: "With manager" },
                  { value: "pending_finance", label: "With finance" },
                  { value: "all", label: "All open" },
                ]}
              />
            </>
          }
        />
      </TableCard>
      <ClaimDetailDialog id={open} onClose={() => setOpen(null)} mode="admin" />
      <ReasonDialog
        open={!!reject}
        onOpenChange={(v) => !v && setReject(null)}
        title={reject && reject.length > 1 ? `Reject ${reject.length} claims` : "Reject claim"}
        onConfirm={async (note) => {
          await decide.mutateAsync({ ids: reject!, decision: "rejected", note });
          setReject(null);
        }}
      />
    </div>
  );
}
