import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { fmtDate, todayIST } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { LeaveRequest } from "@/lib/types";
import { StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Segmented } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/page";
import { PersonCell } from "@/components/ui/avatar";
import { StatusTag } from "@/components/ui/tag";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type F = "pending" | "approved" | "rejected" | "cancelled" | "all";

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dates = (r: LeaveRequest) => (r.startDate === r.endDate ? fmtDate(r.startDate) : `${fmtDate(r.startDate, false)} – ${fmtDate(r.endDate)}`);

export default function Requests() {
  const { can, tenant } = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = useState<F>("pending");
  const [q, setQ] = useState("");
  const [reject, setReject] = useState<string[] | null>(null);
  const [cancel, setCancel] = useState<LeaveRequest | null>(null);
  const all = useQuery({ queryKey: ["leave", "requests"], queryFn: () => api.get<LeaveRequest[]>(`/admin/leave/requests${qs({})}`) });
  const canApprove = can("leave", "approve");
  const today = todayIST();
  const month = today.slice(0, 7);
  const weekEnd = addDays(today, 7);

  const stats = useMemo(() => {
    const r = all.data ?? [];
    const decidedThisMonth = (s: string) => r.filter((x) => x.status === s && x.startDate.slice(0, 7) <= month && x.endDate.slice(0, 7) >= month).length;
    return {
      pending: r.filter((x) => x.status === "pending").length,
      soon: r.filter((x) => x.status === "pending" && x.startDate <= weekEnd).length,
      away: r.filter((x) => x.status === "approved" && x.startDate <= today && x.endDate >= today).length,
      approved: decidedThisMonth("approved"),
      rejected: decidedThisMonth("rejected"),
    };
  }, [all.data, today, month, weekEnd]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (all.data ?? []).filter((r) => (status === "all" || r.status === status) && (!t || `${r.employeeName} ${r.employeeCode} ${r.code} ${r.typeName}`.toLowerCase().includes(t)));
  }, [all.data, status, q]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["leave"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const decide = useMutation({
    mutationFn: (v: { ids: string[]; decision: "approved" | "rejected"; note?: string }) =>
      v.ids.length === 1
        ? api.post(`/admin/leave/requests/${v.ids[0]}/decision`, { decision: v.decision, note: v.note || null }).then(() => ({ done: 1, errors: [] as { id: string; message: string }[] }))
        : api.post<{ done: number; errors: { id: string; message: string }[] }>("/admin/leave/requests/bulk-decision", { ids: v.ids, decision: v.decision, note: v.note || null }),
    onSuccess: (r, v) => {
      if (r.errors.length) toast.error(`${r.done} updated, ${r.errors.length} skipped: ${r.errors[0]!.message}`);
      else toast.success(`${r.done} request${r.done === 1 ? "" : "s"} ${v.decision}`);
      refresh();
    },
  });
  const cancelM = useMutation({
    mutationFn: (id: string) => api.post(`/admin/leave/requests/${id}/cancel`),
    onSuccess: () => {
      toast.success("Leave cancelled and balance restored");
      setCancel(null);
      refresh();
    },
  });

  const isOwn = (r: LeaveRequest) => r.employeeId === tenant?.employeeId;

  const columns = useMemo<ColumnDef<LeaveRequest, any>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.employeeName, cell: ({ row }) => <PersonCell name={row.original.employeeName ?? ""} sub={`${row.original.employeeCode}${row.original.department ? " · " + row.original.department : ""}`} /> },
      { id: "type", header: "Type", accessorFn: (r) => r.typeName },
      { id: "dates", header: "Dates", accessorFn: (r) => r.startDate, cell: ({ row }) => dates(row.original) },
      { id: "days", header: "Days", accessorFn: (r) => Number(r.days), meta: { align: "right" }, cell: ({ row }) => `${row.original.days}${row.original.halfDay ? " (half)" : ""}` },
      {
        id: "reason",
        header: "Reason",
        accessorFn: (r) => r.reason ?? "",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-[260px] truncate" title={[row.original.reason, row.original.decisionNote ? `Note: ${row.original.decisionNote}` : ""].filter(Boolean).join("\n")}>
            {row.original.reason || "—"}
          </span>
        ),
      },
      { id: "code", header: "Request", accessorFn: (r) => r.code },
      { id: "applied", header: "Applied", accessorFn: (r) => r.createdAt, cell: ({ getValue }) => fmtDate(getValue() as string) },
      { id: "status", header: "Status", accessorFn: (r) => r.status, cell: ({ row: { original: r } }) => (
        <div>
          <StatusTag status={r.status} />
          {r.status === "pending" && r.waitingOn ? <div className={`text-[12px] ${r.waitingOn.yourTurn ? "font-medium" : "text-muted"}`}>{r.waitingOn.yourTurn && !r.waitingOn.asHr ? "Your approval" : `With ${r.waitingOn.label}${r.waitingOn.asHr ? " (HR can approve)" : ""}`}{r.waitingOn.of > 1 ? ` · step ${r.waitingOn.at} of ${r.waitingOn.of}` : ""}</div> : null}
        </div>
      ) },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <StatCard label="Awaiting decision" value={stats.pending} meta={stats.soon ? <span className="tag tag-warn">{stats.soon} start within 7 days</span> : "none starting soon"} onClick={() => setStatus("pending")} />
        <StatCard label="Away today" value={stats.away} meta="on approved leave" />
        <StatCard label="Approved this month" value={stats.approved} onClick={() => setStatus("approved")} />
        <StatCard label="Rejected this month" value={stats.rejected} onClick={() => setStatus("rejected")} />
      </div>
      {all.error ? <ErrorState error={all.error} retry={() => all.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          loading={all.isFetching}
          storageKey="leave-requests"
          empty={status === "pending" ? "No leave requests waiting for you" : "Nothing to show"}
          toolbar={
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee, type or ID" className="!w-[230px]" aria-label="Search" />
              <Segmented<F>
                value={status}
                onChange={setStatus}
                options={[
                  { value: "pending", label: "Pending" },
                  { value: "approved", label: "Approved" },
                  { value: "rejected", label: "Rejected" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "all", label: "All" },
                ]}
              />
            </>
          }
          bulkActions={
            canApprove && status === "pending"
              ? [
                  { label: "Approve", onRun: async (sel) => void (await decide.mutateAsync({ ids: sel.filter((r) => !isOwn(r) && r.waitingOn?.yourTurn !== false).map((r) => r.id), decision: "approved" })) },
                  { label: "Reject", onRun: (sel) => setReject(sel.filter((r) => !isOwn(r) && r.waitingOn?.yourTurn !== false).map((r) => r.id)) },
                ]
              : undefined
          }
          rowActions={(r) => {
            const items = [];
            if (r.status === "pending" && canApprove && !isOwn(r) && r.waitingOn?.yourTurn !== false) {
              items.push({ label: "Approve", onSelect: () => decide.mutate({ ids: [r.id], decision: "approved" }) });
              items.push({ label: "Reject", danger: true, onSelect: () => setReject([r.id]) });
            }
            if ((r.status === "approved" || r.status === "pending") && can("leave", "edit")) items.push({ label: "Cancel leave", danger: true, onSelect: () => setCancel(r) });
            if (!items.length) items.push({ label: isOwn(r) && r.status === "pending" ? "You can't decide your own leave" : r.status === "pending" && r.waitingOn ? `Waiting for ${r.waitingOn.label}` : "No actions", disabled: true, onSelect: () => {} });
            return items;
          }}
        />
      </TableCard>
      <ReasonDialog
        open={!!reject}
        onOpenChange={(v) => !v && setReject(null)}
        title={reject && reject.length > 1 ? `Reject ${reject.length} leave requests` : "Reject leave request"}
        onConfirm={async (note) => {
          if (reject?.length) await decide.mutateAsync({ ids: reject, decision: "rejected", note });
        }}
      />
      <Dialog
        open={!!cancel}
        onOpenChange={(v) => !v && setCancel(null)}
        title="Cancel this leave?"
        description={cancel ? `${cancel.employeeName} · ${cancel.typeName} · ${dates(cancel)}. ${cancel.status === "approved" ? "The days go back to their balance." : ""}` : undefined}
        footer={
          <>
            <Button onClick={() => setCancel(null)}>Keep it</Button>
            <Button variant="danger" loading={cancelM.isPending} onClick={() => cancel && cancelM.mutate(cancel.id)}>
              Cancel leave
            </Button>
          </>
        }
      />
    </div>
  );
}
