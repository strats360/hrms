import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Card, CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { PersonCell } from "@/components/ui/avatar";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { ErrorState } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { Tag, type Tone } from "@/components/ui/tag";

export interface CompOffRow {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  department?: string | null;
  workDate: string;
  dayType: "weekly_off" | "holiday" | "granted";
  workMinutes: number;
  days: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  decisionNote: string | null;
  expiresOn: string | null;
  lapsedDays: number;
}
interface Settings {
  expiryDays: number;
  claimWithinDays: number;
}

export const COMP_OFF_TONE: Record<CompOffRow["status"], Tone> = { pending: "warn", approved: "ok", rejected: "bad", cancelled: "neutral", expired: "neutral" };
export const COMP_OFF_LABEL: Record<CompOffRow["status"], string> = { pending: "Waiting", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", expired: "Expired" };
export const DAY_TYPE: Record<CompOffRow["dayType"], string> = { weekly_off: "Weekly off", holiday: "Holiday", granted: "Granted by HR" };
const hours = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "—");

export default function CompOff() {
  const qc = useQueryClient();
  const { can } = useSession();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const q = useQuery({ queryKey: ["leave", "comp-off", filter], queryFn: () => api.get<{ settings: Settings; rows: CompOffRow[] }>(`/admin/leave/comp-off${filter === "pending" ? "?status=pending" : ""}`) });
  const [rejecting, setRejecting] = useState<CompOffRow | null>(null);
  const [granting, setGranting] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["leave"] });
  const decide = useMutation({
    mutationFn: ({ r, decision, note }: { r: CompOffRow; decision: "approved" | "rejected"; note?: string }) => api.post(`/admin/leave/comp-off/${r.id}/decision`, { decision, note: note ?? null }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === "approved" ? `Approved. ${v.r.days} day${v.r.days === 1 ? "" : "s"} added to ${v.r.employeeName}'s comp off` : "Rejected");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns = useMemo<ColumnDef<CompOffRow>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.employeeName, cell: ({ row: { original: r } }) => <PersonCell employeeId={r.employeeId} name={r.employeeName ?? ""} sub={[r.employeeCode, r.department].filter(Boolean).join(" · ")} /> },
      { id: "date", header: "Worked on", accessorKey: "workDate", cell: ({ row: { original: r } }) => <div>{fmtDate(r.workDate)}<div className="text-muted text-[12px]">{DAY_TYPE[r.dayType]}</div></div> },
      { id: "worked", header: "Worked", accessorKey: "workMinutes", cell: ({ getValue }) => hours(getValue<number>()) },
      { id: "days", header: "Comp off", accessorKey: "days", meta: { align: "right" }, cell: ({ getValue }) => `${getValue<number>()} day${getValue<number>() === 1 ? "" : "s"}` },
      { id: "reason", header: "Reason", accessorKey: "reason", enableSorting: false, cell: ({ getValue }) => <span className="text-muted line-clamp-2 max-w-[260px] whitespace-normal text-[12.5px]">{getValue<string>() ?? "—"}</span> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: r } }) => <div><Tag tone={COMP_OFF_TONE[r.status]}>{COMP_OFF_LABEL[r.status]}</Tag>{r.status === "approved" && r.expiresOn ? <div className="text-muted text-[12px]">use by {fmtDate(r.expiresOn)}</div> : r.status === "expired" && r.lapsedDays ? <div className="text-muted text-[12px]">{r.lapsedDays} lapsed</div> : null}</div> },
      {
        id: "quick",
        header: "",
        enableSorting: false,
        cell: ({ row: { original: r } }) =>
          r.status === "pending" && can("leave", "approve") ? (
            <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="primary" loading={decide.isPending && decide.variables?.r.id === r.id && decide.variables.decision === "approved"} onClick={() => decide.mutate({ r, decision: "approved" })}>
                Approve
              </Button>
              <Button size="sm" onClick={() => setRejecting(r)}>
                Reject
              </Button>
            </div>
          ) : null,
      },
    ],
    [can, decide.isPending, decide.variables],
  );

  return (
    <div className="flex flex-col gap-4">
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <CardHeader
          className="py-2"
          title="Comp off"
          sub="Employees claim comp off for weekly offs and holidays they worked, from self-service. A full shift earns a day; half a shift earns half."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <PillTabs<"pending" | "all"> value={filter} onChange={setFilter} tabs={[{ value: "pending", label: "Waiting" }, { value: "all", label: "All" }]} />
              {can("leave", "configure") ? (
                <Button onClick={() => setGranting(true)}>
                  <Plus size={15} /> Grant comp off
                </Button>
              ) : null}
            </div>
          }
        />
        <DataTable data={q.data?.rows ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} storageKey="comp-off" empty={filter === "pending" ? "No comp off requests are waiting." : "No comp off yet."} />
      </TableCard>
      {q.data && can("leave", "configure") ? <SettingsCard settings={q.data.settings} /> : null}
      <ReasonDialog
        open={!!rejecting}
        onOpenChange={(v) => !v && setRejecting(null)}
        title={`Reject comp off for ${rejecting?.employeeName ?? ""}?`}
        onConfirm={async (note) => {
          await decide.mutateAsync({ r: rejecting!, decision: "rejected", note });
          setRejecting(null);
        }}
      />
      {granting ? <GrantDialog onClose={() => setGranting(false)} /> : null}
    </div>
  );
}

function SettingsCard({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ expiryDays: String(settings.expiryDays), claimWithinDays: String(settings.claimWithinDays) });
  useEffect(() => setF({ expiryDays: String(settings.expiryDays), claimWithinDays: String(settings.claimWithinDays) }), [settings]);
  const save = useMutation({
    mutationFn: () => api.put("/admin/leave/comp-off/settings", { expiryDays: Number(f.expiryDays), claimWithinDays: Number(f.claimWithinDays) }),
    onSuccess: () => {
      toast.success("Comp off rules saved");
      qc.invalidateQueries({ queryKey: ["leave", "comp-off"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dirty = Number(f.expiryDays) !== settings.expiryDays || Number(f.claimWithinDays) !== settings.claimWithinDays;
  return (
    <Card className="!gap-3">
      <CardHeader title="Comp off rules" sub="Unused comp off lapses on its expiry date (checked daily)." />
      <div className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,220px))_auto] sm:items-end">
        <Field label="Claim within (days of the work)">
          <Input type="number" min={1} max={90} value={f.claimWithinDays} onChange={(e) => setF({ ...f, claimWithinDays: e.target.value })} />
        </Field>
        <Field label="Expires (days after the work)">
          <Input type="number" min={7} max={365} value={f.expiryDays} onChange={(e) => setF({ ...f, expiryDays: e.target.value })} />
        </Field>
        <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  );
}

function GrantDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [emp, setEmp] = useState<{ id: string; fullName: string; employeeCode: string } | null>(null);
  const [date, setDate] = useState("");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const hits = useQuery({ queryKey: ["employees", "pick", search], queryFn: () => api.get<{ rows: { id: string; fullName: string; employeeCode: string }[] }>(`/admin/employees?q=${encodeURIComponent(search)}&pageSize=6`), enabled: search.trim().length >= 2 && !emp });
  const grant = useMutation({
    mutationFn: () => api.post("/admin/leave/comp-off", { employeeId: emp!.id, date, days: Number(days), reason: reason.trim() }),
    onSuccess: () => {
      toast.success(`Comp off added to ${emp!.fullName}'s balance`);
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Grant comp off"
      description="For work the attendance system didn't capture, such as travel or a client site. It's credited straight away."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!emp || !date || reason.trim().length < 3} loading={grant.isPending} onClick={() => grant.mutate()}>
            Grant
          </Button>
        </>
      }
    >
      <Field label="Employee">
        {emp ? (
          <div className="input flex items-center justify-between">
            <span>
              {emp.fullName} <span className="text-muted">· {emp.employeeCode}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEmp(null)}>
              Change
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Input autoFocus placeholder="Search by name or employee ID" value={search} onChange={(e) => setSearch(e.target.value)} />
            {hits.data?.rows.length ? (
              <div className="card elev-md absolute inset-x-0 top-[calc(100%+4px)] z-10 !gap-0 !p-1">
                {hits.data.rows.map((h) => (
                  <button key={h.id} type="button" className="cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--tint-1)]" onClick={() => setEmp(h)}>
                    {h.fullName} <span className="text-muted">· {h.employeeCode}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Day worked">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Comp off">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="1">1 day</option>
            <option value="0.5">Half a day</option>
          </Select>
        </Field>
      </div>
      <Field label="Reason">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Saturday client visit in Surat" />
      </Field>
    </Dialog>
  );
}
