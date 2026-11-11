import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ATTENDANCE_STATUS_LABELS, fmtDate, type AttendanceStatus } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Segmented } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/page";
import { PersonCell } from "@/components/ui/avatar";
import { StatusTag } from "@/components/ui/tag";
import type { WaitingOn } from "@/lib/types";
import { ReasonDialog } from "@/components/ui/reason-dialog";

interface Correction {
  waitingOn?: WaitingOn | null;
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  date: string;
  issue: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  requestedStatus: string | null;
  reason: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: string;
}

type F = "pending" | "approved" | "rejected" | "all";

function requested(c: Correction) {
  const parts: string[] = [];
  if (c.requestedCheckIn) parts.push(`In ${c.requestedCheckIn}`);
  if (c.requestedCheckOut) parts.push(`Out ${c.requestedCheckOut}`);
  if (c.requestedStatus) parts.push(`Mark ${ATTENDANCE_STATUS_LABELS[c.requestedStatus as AttendanceStatus] ?? c.requestedStatus}`);
  return parts.join(" · ") || "—";
}

export default function Corrections() {
  const { can, tenant } = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = useState<F>("pending");
  const [reject, setReject] = useState<string[] | null>(null);
  const query = useQuery({
    queryKey: ["attendance", "corrections", status],
    queryFn: () => api.get<Correction[]>(`/admin/attendance/corrections${qs({ status: status === "all" ? undefined : status })}`),
  });
  const canApprove = can("attendance", "approve");

  const done = () => {
    qc.invalidateQueries({ queryKey: ["attendance"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const decide = useMutation({
    mutationFn: (v: { ids: string[]; decision: "approved" | "rejected"; note?: string }) =>
      v.ids.length === 1
        ? api.post(`/admin/attendance/corrections/${v.ids[0]}/decision`, { decision: v.decision, note: v.note || null }).then(() => ({ done: 1, errors: [] as { id: string; message: string }[] }))
        : api.post<{ done: number; errors: { id: string; message: string }[] }>("/admin/attendance/corrections/bulk-decision", { ids: v.ids, decision: v.decision, note: v.note || null }),
    onSuccess: (r, v) => {
      if (r.errors.length) toast.error(`${r.done} updated, ${r.errors.length} skipped: ${r.errors[0]!.message}`);
      else toast.success(`${r.done} correction${r.done === 1 ? "" : "s"} ${v.decision}`);
      done();
    },
  });

  const columns = useMemo<ColumnDef<Correction, any>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.employeeName, cell: ({ row }) => <PersonCell employeeId={row.original.employeeId} name={row.original.employeeName} sub={row.original.employeeCode} /> },
      { id: "date", header: "Date", accessorFn: (r) => r.date, cell: ({ getValue }) => fmtDate(getValue() as string) },
      { id: "issue", header: "Issue", accessorFn: (r) => r.issue },
      { id: "requested", header: "Requested change", accessorFn: (r) => requested(r), enableSorting: false },
      {
        id: "reason",
        header: "Reason",
        accessorFn: (r) => r.reason ?? "",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-[240px] truncate" title={row.original.reviewNote ? `${row.original.reason ?? ""}\nReviewer: ${row.original.reviewNote}` : (row.original.reason ?? "")}>
            {row.original.reason || "—"}
          </span>
        ),
      },
      { id: "submitted", header: "Submitted", accessorFn: (r) => r.createdAt, cell: ({ getValue }) => fmtDate(getValue() as string) },
      { id: "status", header: "Status", accessorFn: (r) => r.status, cell: ({ row: { original: r } }) => (
        <div>
          <StatusTag status={r.status} />
          {r.status === "pending" && r.waitingOn ? <div className={`text-[12px] ${r.waitingOn.yourTurn ? "font-medium" : "text-muted"}`}>{r.waitingOn.yourTurn && !r.waitingOn.asHr ? "Your approval" : `With ${r.waitingOn.label}${r.waitingOn.asHr ? " (HR can approve)" : ""}`}{r.waitingOn.of > 1 ? ` · step ${r.waitingOn.at} of ${r.waitingOn.of}` : ""}</div> : null}
        </div>
      ) },
    ],
    [],
  );

  const rows = query.data ?? [];
  const isOwn = (r: Correction) => r.employeeId === tenant?.employeeId;

  return (
    <div className="flex flex-col gap-4">
      {query.error ? <ErrorState error={query.error} retry={() => query.refetch()} /> : null}
      <TableCard>
        <div className="pb-1 pt-2">
          <div className="card-title text-[17px]">Correction requests</div>
          <div className="text-muted text-[13px]">Employees ask to fix a missed punch, a failed biometric read or an unmarked WFH day. Approving updates the attendance record.</div>
        </div>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          loading={query.isFetching}
          storageKey="attendance-corrections"
          empty={status === "pending" ? "No corrections waiting for you" : "Nothing to show"}
          toolbar={
            <Segmented<F>
              value={status}
              onChange={setStatus}
              options={[
                { value: "pending", label: "Pending" },
                { value: "approved", label: "Approved" },
                { value: "rejected", label: "Rejected" },
                { value: "all", label: "All" },
              ]}
            />
          }
          bulkActions={
            canApprove && status === "pending"
              ? [
                  { label: "Approve", onRun: async (sel) => void (await decide.mutateAsync({ ids: sel.filter((r) => !isOwn(r) && r.waitingOn?.yourTurn !== false).map((r) => r.id), decision: "approved" })) },
                  { label: "Reject", onRun: (sel) => setReject(sel.filter((r) => !isOwn(r) && r.waitingOn?.yourTurn !== false).map((r) => r.id)) },
                ]
              : undefined
          }
          rowActions={
            canApprove
              ? (r) =>
                  r.status === "pending" && !isOwn(r) && r.waitingOn?.yourTurn !== false
                    ? [
                        { label: "Approve", onSelect: () => decide.mutate({ ids: [r.id], decision: "approved" }) },
                        { label: "Reject", danger: true, onSelect: () => setReject([r.id]) },
                      ]
                    : [{ label: r.status === "pending" ? (isOwn(r) ? "You can't decide your own request" : `Waiting for ${r.waitingOn?.label ?? "another approver"}`) : `Already ${r.status}`, disabled: true, onSelect: () => {} }]
              : undefined
          }
        />
      </TableCard>
      <ReasonDialog
        open={!!reject}
        onOpenChange={(v) => !v && setReject(null)}
        title={reject && reject.length > 1 ? `Reject ${reject.length} corrections` : "Reject correction"}
        onConfirm={async (note) => {
          if (reject?.length) await decide.mutateAsync({ ids: reject, decision: "rejected", note });
        }}
      />
    </div>
  );
}
