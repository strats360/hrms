import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { EXIT_TYPE_LABELS, EXIT_TYPES, fmtDate, inr, todayIST, type ExitType } from "@hrms/shared";
import { CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { PersonCell } from "@/components/ui/avatar";
import { Tag, type Tone } from "@/components/ui/tag";
import { ErrorState } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

export interface ExitRow {
  id: string;
  code: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  type: ExitType;
  typeLabel: string;
  status: string;
  statusLabel: string;
  resignationDate: string;
  lastWorkingDay: string;
  clearanceDone: number;
  clearanceTotal: number;
  netAmount: number | null;
}
interface ExitList {
  counts: { requested: number; notice: number; pendingSettlement: number; leavingThisMonth: number };
  rows: ExitRow[];
}

export const EXIT_TONE: Record<string, Tone> = { requested: "accent", notice: "warn", settlement: "outline", approved: "ok", settled: "neutral", cancelled: "neutral" };
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

export default function Exits() {
  const nav = useNavigate();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<"open" | "settled" | "all">("open");
  const [starting, setStarting] = useState(false);
  const q = useQuery({ queryKey: ["exits", filter], queryFn: () => api.get<ExitList>(`/admin/exits${filter === "all" ? "" : `?status=${filter}`}`) });
  const money = can("payroll", "view");

  // "Start exit" from an employee's profile: /employees/exits?employee=<id>
  const preset = params.get("employee");
  useEffect(() => {
    if (preset) setStarting(true);
  }, [preset]);

  const columns = useMemo<ColumnDef<ExitRow>[]>(
    () => [
      { id: "employee", accessorKey: "employeeName", header: "Employee", enableHiding: false, cell: ({ row }) => <PersonCell name={row.original.employeeName} sub={[row.original.employeeCode, row.original.department].filter(Boolean).join(" · ")} /> },
      { id: "type", accessorKey: "typeLabel", header: "Type" },
      { id: "lastWorkingDay", accessorKey: "lastWorkingDay", header: "Last working day", cell: ({ getValue }) => fmtDate(getValue() as string) },
      { id: "clearance", header: "Checklist", enableSorting: false, cell: ({ row }) => <span className="num">{row.original.clearanceDone}/{row.original.clearanceTotal}</span> },
      ...(money ? [{ id: "net", accessorKey: "netAmount", header: "Settlement", meta: { align: "right" }, cell: ({ getValue }) => {
          const n = getValue() as number | null;
          if (n === null) return <span className="text-muted">Not drafted</span>;
          return n < 0 ? <span className="num">Recover {inr(-n)}</span> : <span className="num">{inr(n)}</span>;
        } } as ColumnDef<ExitRow>] : []),
      { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <Tag tone={EXIT_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</Tag> },
    ],
    [money],
  );

  const c = q.data?.counts;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <StatCard label="Resignations to review" value={c?.requested ?? "…"} meta="submitted by employees" />
        <StatCard label="Serving notice" value={c?.notice ?? "…"} meta="exit checklist open" />
        <StatCard label="Settlements pending" value={c?.pendingSettlement ?? "…"} meta="drafted or approved" />
        <StatCard label="Leaving this month" value={c?.leavingThisMonth ?? "…"} meta={new Date().toLocaleString("en-IN", { month: "short", year: "numeric" })} />
      </div>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <CardHeader
          className="py-2"
          title="Exits and full & final"
          sub="Notice period, exit checklist and the full and final settlement. The last month's salary is paid through payroll, up to the last working day."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <PillTabs<"open" | "settled" | "all">
                value={filter}
                onChange={setFilter}
                tabs={[
                  { value: "open", label: "Open" },
                  { value: "settled", label: "Settled" },
                  { value: "all", label: "All" },
                ]}
              />
              {can("employees", "edit") ? (
                <Button variant="primary" onClick={() => setStarting(true)}>
                  <Plus size={16} /> Start exit
                </Button>
              ) : null}
            </div>
          }
        />
        <DataTable<ExitRow>
          data={q.data?.rows ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          loading={q.isFetching}
          storageKey="exits"
          onRowClick={(r) => nav(`/employees/exits/${r.id}`)}
          empty={filter === "open" ? "No one is leaving right now." : "Nothing here yet."}
          rowActions={(r) => [
            { label: "Open", onSelect: () => nav(`/employees/exits/${r.id}`) },
            { label: "View profile", onSelect: () => nav(`/employees/${r.employeeId}`) },
          ]}
        />
      </TableCard>
      <StartExitDialog
        open={starting}
        employeeId={preset}
        onClose={() => {
          setStarting(false);
          if (preset) {
            params.delete("employee");
            setParams(params, { replace: true });
          }
        }}
        onDone={(id) => nav(`/employees/exits/${id}`)}
      />
    </div>
  );
}

function StartExitDialog({ open, employeeId, onClose, onDone }: { open: boolean; employeeId: string | null; onClose: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [emp, setEmp] = useState<{ id: string; fullName: string; employeeCode: string } | null>(null);
  const [type, setType] = useState<ExitType>("resignation");
  const [resignationDate, setResignationDate] = useState(todayIST());
  const [lastWorkingDay, setLastWorkingDay] = useState(addDays(todayIST(), 29));
  const [noticeDays, setNoticeDays] = useState("");
  const [noticeWaived, setNoticeWaived] = useState(false);
  const [payInLieu, setPayInLieu] = useState(false);
  const [reason, setReason] = useState("");
  const hits = useQuery({ queryKey: ["employees", "pick", search], queryFn: () => api.get<{ rows: { id: string; fullName: string; employeeCode: string }[] }>(`/admin/employees?q=${encodeURIComponent(search)}&pageSize=6`), enabled: open && search.trim().length >= 2 && !emp });
  const presetEmp = useQuery({ queryKey: ["employee", employeeId], queryFn: () => api.get<{ id: string; fullName: string; employeeCode: string }>(`/admin/employees/${employeeId}`), enabled: open && !!employeeId });
  useEffect(() => {
    if (presetEmp.data && !emp) setEmp({ id: presetEmp.data.id, fullName: presetEmp.data.fullName, employeeCode: presetEmp.data.employeeCode });
  }, [presetEmp.data, emp]);

  const start = useMutation({
    mutationFn: () => api.post<{ id: string }>("/admin/exits", { employeeId: emp!.id, type, resignationDate, lastWorkingDay, noticeDays: noticeDays === "" ? undefined : Number(noticeDays), noticeWaived, payInLieu, reason: reason.trim() || null }),
    onSuccess: (r) => {
      toast.success(`Exit started for ${emp!.fullName}`);
      qc.invalidateQueries({ queryKey: ["exits"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-stats"] });
      onDone(r.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dated = type === "resignation" ? "Resignation date" : type === "termination" ? "Notice given on" : "Notice date";
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Start an exit"
      description="The dates go on the employee record. Payroll pays their last month up to the last working day."
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!emp || lastWorkingDay < resignationDate} loading={start.isPending} onClick={() => start.mutate()}>
            Start exit
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
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as ExitType)}>
            {EXIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EXIT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notice period (days)" hint="Blank uses the company default">
          <Input type="number" min={0} max={180} value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} placeholder="30" />
        </Field>
        <Field label={dated}>
          <Input type="date" value={resignationDate} onChange={(e) => setResignationDate(e.target.value)} />
        </Field>
        <Field label="Last working day" error={lastWorkingDay < resignationDate ? "Can't be before the resignation date" : null}>
          <Input type="date" value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <Checkbox checked={noticeWaived} onChange={setNoticeWaived} label="Waive any notice shortfall (no recovery)" />
        {type === "termination" ? <Checkbox checked={payInLieu} onChange={setPayInLieu} label="Pay the notice shortfall in lieu of notice" /> : null}
      </div>
      <Field label="Reason or notes">
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shown on the exit record, not on letters" />
      </Field>
    </Dialog>
  );
}
