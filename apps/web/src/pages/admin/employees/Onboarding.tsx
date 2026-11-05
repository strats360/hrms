import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { StatCard, TableCard, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/field";
import { StatusTag } from "@/components/ui/tag";
import { ErrorState, Notice } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Row {
  employeeId: string;
  name: string;
  code: string;
  email: string;
  designation: string | null;
  department: string | null;
  dateOfJoining: string;
  sentAt: string;
  progress: number;
  status: string;
  statusLabel: string;
  pending: string[];
}
interface Tracker {
  summary: { invited: number; inProgress: number; awaiting: number; joiningThisMonth: number };
  rows: Row[];
}

export function Progress({ pct }: { pct: number }) {
  return (
    <div className="flex min-w-[140px] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-[var(--radius-md)]" style={{ background: "var(--tint-2)" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full" style={{ width: `${pct}%`, background: "var(--color-accent)" }} />
      </div>
      <span className="num text-[12px]">{pct}%</span>
    </div>
  );
}

export default function Onboarding() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const edit = can("employees", "edit");
  const q = useQuery({ queryKey: ["onboarding"], queryFn: () => api.get<Tracker>("/admin/onboarding") });
  const [verifying, setVerifying] = useState<Row | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<"probation" | "active">("probation");

  const invite = useMutation({
    mutationFn: (r: Row) => api.post(`/admin/employees/${r.employeeId}/invite`),
    onSuccess: (_d, r) => {
      toast.success(`Invite sent to ${r.email}`);
      qc.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
  const verify = useMutation({
    mutationFn: ({ r, status }: { r: Row; status: string }) => api.post(`/admin/onboarding/${r.employeeId}/verify`, { status }),
    onSuccess: (_d, { r }) => {
      toast.success(`${r.name} is verified and active`);
      setVerifying(null);
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee", r.employeeId] });
      qc.invalidateQueries({ queryKey: ["employee-stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Employee",
        enableHiding: false,
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-muted text-[12px]">
              {[row.original.designation, row.original.email].filter(Boolean).join(" · ")}
            </div>
          </div>
        ),
      },
      { id: "dateOfJoining", accessorKey: "dateOfJoining", header: "Joining", cell: ({ getValue }) => fmtDate(getValue() as string) },
      { id: "sentAt", accessorKey: "sentAt", header: "Invite sent", cell: ({ getValue }) => fmtDate(String(getValue()).slice(0, 10), false) },
      { id: "progress", accessorKey: "progress", header: "Progress", cell: ({ getValue }) => <Progress pct={getValue() as number} /> },
      { id: "pending", accessorKey: "pending", header: "Pending", enableSorting: false, cell: ({ row }) => <div className="text-muted min-w-[160px] max-w-[240px] whitespace-normal text-[12.5px]">{row.original.pending.join(", ") || "—"}</div> },
      { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusTag status={row.original.status} label={row.original.statusLabel} /> },
      {
        id: "quick",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          edit ? (
            <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {row.original.status === "submitted" ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setVerifyStatus("probation");
                    setVerifying(row.original);
                  }}
                >
                  Verify & activate
                </Button>
              ) : null}
              {["invited", "opened", "in_progress", "expired"].includes(row.original.status) ? (
                <Button size="sm" loading={invite.isPending && invite.variables?.employeeId === row.original.employeeId} onClick={() => invite.mutate(row.original)}>
                  Resend invite
                </Button>
              ) : null}
            </div>
          ) : null,
      },
    ],
    [edit, invite.isPending, invite.variables],
  );

  const s = q.data?.summary;
  const month = new Date().toLocaleString("en-IN", { month: "short", year: "numeric" });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <StatCard label="Invited" value={s?.invited ?? "…"} meta="not started" />
        <StatCard label="In progress" value={s?.inProgress ?? "…"} meta="filling details" />
        <StatCard label="Awaiting HR verification" value={s?.awaiting ?? "…"} meta="documents & bank" />
        <StatCard label="Joining this month" value={s?.joiningThisMonth ?? "…"} meta={month} />
      </div>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <CardHeader
          className="py-2"
          title="New joiners"
          sub="Invites are emailed from Add employee or bulk import. Employees complete their own details, then HR verifies."
          actions={
            edit ? (
              <Button variant="primary" onClick={() => nav("/employees/new")}>
                <Plus size={16} /> Invite new joiner
              </Button>
            ) : null
          }
        />
        <DataTable<Row>
          data={q.data?.rows ?? []}
          columns={columns}
          getRowId={(r) => r.employeeId}
          loading={q.isFetching}
          onRowClick={(r) => nav(`/employees/${r.employeeId}`)}
          empty="No one is onboarding right now. Add an employee with an invite to start."
          rowActions={(r) => [
            { label: "View profile", onSelect: () => nav(`/employees/${r.employeeId}`) },
            ...(edit && r.status === "submitted"
              ? [
                  {
                    label: "Verify & activate",
                    onSelect: () => {
                      setVerifyStatus("probation");
                      setVerifying(r);
                    },
                  },
                ]
              : []),
            ...(edit && r.status !== "verified" && r.status !== "submitted" ? [{ label: "Resend invite", onSelect: () => invite.mutate(r) }] : []),
          ]}
        />
      </TableCard>
      <Dialog
        open={!!verifying}
        onOpenChange={(v) => !v && setVerifying(null)}
        title={`Verify ${verifying?.name ?? ""}`}
        description="Check their documents and bank details on the profile first. Pending documents will be marked as verified."
        footer={
          <>
            <Button onClick={() => setVerifying(null)}>Cancel</Button>
            <Button variant="primary" loading={verify.isPending} onClick={() => verifying && verify.mutate({ r: verifying, status: verifyStatus })}>
              Verify & activate
            </Button>
          </>
        }
      >
        <div className="text-[13px]">Start them as</div>
        <Segmented<"probation" | "active">
          value={verifyStatus}
          onChange={setVerifyStatus}
          options={[
            { value: "probation", label: "On probation" },
            { value: "active", label: "Confirmed (active)" },
          ]}
        />
        {verifying ? (
          <Notice tone="sel">
            <button className="btn btn-ghost !p-0" onClick={() => nav(`/employees/${verifying.employeeId}`)}>
              Open {verifying.name}'s profile to review
            </button>
          </Notice>
        ) : null}
      </Dialog>
    </div>
  );
}
