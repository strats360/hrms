import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { addWeeks, fmtDate, hoursLabel, TIMESHEET_STATUS_LABEL, todayIST, weekDates, type TimesheetStatus } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { PersonCell } from "@/components/ui/avatar";
import { ErrorState, Loading } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { weekLabel, WeekTable, type Project } from "@/components/timesheets/Grid";
import { SHEET_TONE } from "@/pages/ess/Timesheets";

interface TeamRow { employeeId: string; name: string; code: string; department: string | null; id: string | null; status: TimesheetStatus | "missing"; totalMinutes: number; billableMinutes: number; submittedAt: string | null; mine: boolean }
type View = "week" | "report" | "projects";

export default function Timesheets() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>((params.get("view") as View) ?? "week");
  return (
    <div className="flex flex-col gap-4">
      <PillTabs value={view} onChange={setView} tabs={[{ value: "week", label: "Team week" }, { value: "report", label: "Hours by project" }, ...(can("attendance", "configure") ? [{ value: "projects" as View, label: "Projects" }] : [])]} />
      {view === "week" ? <TeamWeek week={params.get("week")} setWeek={(w) => setParams({ week: w })} /> : view === "report" ? <Report /> : <Projects />}
    </div>
  );
}

function TeamWeek({ week, setWeek }: { week: string | null; setWeek: (w: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["timesheets", "team", week], queryFn: () => api.get<{ week: string; current: string; canApprove: boolean; rows: TeamRow[] }>(`/admin/attendance/timesheets${week ? `?week=${week}` : ""}`) });
  const [open, setOpen] = useState<TeamRow | null>(null);
  const [find, setFind] = useState("");
  const [status, setStatus] = useState("");
  const act = useMutation({
    mutationFn: (path: string) => api.post<Record<string, number>>(path, { week: q.data!.week }),
    onSuccess: (r) => (toast.success(r.approved != null ? `${r.approved} approved` : `${r.reminded} reminded`), qc.invalidateQueries({ queryKey: ["timesheets"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns = useMemo<ColumnDef<TeamRow>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => <PersonCell employeeId={r.employeeId} name={r.name} sub={[r.code, r.department].filter(Boolean).join(" · ")} /> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: r } }) => <Tag tone={SHEET_TONE[r.status]}>{r.status === "missing" ? "Not submitted" : TIMESHEET_STATUS_LABEL[r.status]}</Tag> },
      { id: "hours", header: "Hours", accessorKey: "totalMinutes", cell: ({ getValue }) => <span className="num">{hoursLabel(getValue<number>())}</span> },
      { id: "billable", header: "Billable", accessorKey: "billableMinutes", cell: ({ row: { original: r } }) => <span className="num">{hoursLabel(r.billableMinutes)}{r.totalMinutes ? <span className="text-muted"> · {Math.round((r.billableMinutes / r.totalMinutes) * 100)}%</span> : null}</span> },
      { id: "submitted", header: "Submitted", accessorKey: "submittedAt", cell: ({ getValue }) => (getValue<string | null>() ? fmtDate(getValue<string>().slice(0, 10)) : "—") },
    ],
    [],
  );
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const waiting = d.rows.filter((r) => r.status === "submitted" && !r.mine).length;
  // what needs a decision first, then what's still to come in, then what's done
  const ORDER: Record<string, number> = { submitted: 0, rejected: 1, draft: 2, missing: 3, approved: 4 };
  const shown = d.rows
    .filter((r) => (!status || r.status === status) && (!find.trim() || `${r.name} ${r.code}`.toLowerCase().includes(find.trim().toLowerCase())))
    .sort((a, b) => ORDER[a.status]! - ORDER[b.status]! || a.name.localeCompare(b.name));
  const missing = d.rows.filter((r) => r.status === "missing" || r.status === "draft" || r.status === "rejected").length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon size="sm" aria-label="Previous week" onClick={() => setWeek(addWeeks(d.week, -1))}><ChevronLeft size={16} /></Button>
        <div className="min-w-[190px] text-center font-medium">{weekLabel(weekDates(d.week))}</div>
        <Button icon size="sm" aria-label="Next week" disabled={d.week >= d.current} onClick={() => setWeek(addWeeks(d.week, 1))}><ChevronRight size={16} /></Button>
        <div className="flex-1" />
        {d.canApprove ? <Button disabled={!missing} loading={act.isPending && act.variables?.endsWith("remind")} onClick={() => act.mutate("/admin/attendance/timesheets/remind")}>Remind {missing || ""} not submitted</Button> : null}
        {d.canApprove ? <Button variant="primary" disabled={!waiting} loading={act.isPending && act.variables?.endsWith("approve-all")} onClick={() => act.mutate("/admin/attendance/timesheets/approve-all")}>Approve {waiting || ""} waiting</Button> : null}
      </div>
      <TableCard>
        <CardHeader className="py-2" title="Timesheets" sub={`${d.rows.length - missing} of ${d.rows.length} submitted. Open one to see the hours and approve or send it back.`} />
        <DataTable
          data={shown}
          columns={columns}
          getRowId={(r) => r.employeeId}
          onRowClick={(r) => (r.id ? setOpen(r) : undefined)}
          storageKey="timesheets-team"
          toolbar={
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Find a person" placeholder="Find a person" value={find} onChange={(e) => setFind(e.target.value)} className="!w-[200px]" />
              <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="!w-[190px]">
                <option value="">All</option>
                <option value="submitted">Waiting for approval</option>
                <option value="missing">Not submitted</option>
                <option value="draft">Draft</option>
                <option value="rejected">Sent back</option>
                <option value="approved">Approved</option>
              </Select>
            </div>
          }
          empty={find || status ? "Nobody matches." : "Nobody on your team yet."}
        />
      </TableCard>
      {open?.id ? <SheetDialog row={open} canApprove={d.canApprove && !open.mine} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function SheetDialog({ row, canApprove, onClose }: { row: TeamRow; canApprove: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["timesheets", "sheet", row.id], queryFn: () => api.get<{ sheet: { id: string; status: TimesheetStatus; weekStart: string; rejectReason: string | null }; dates: string[]; rows: { projectId: string; note: string; minutes: Record<string, number> }[]; projects: Project[]; attendance: Record<string, { minutes: number; status: string }> }>(`/admin/attendance/timesheets/sheets/${row.id}`) });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const act = useMutation({
    mutationFn: (approve: boolean) => api.post(`/admin/attendance/timesheets/sheets/${row.id}/${approve ? "approve" : "reject"}`, approve ? {} : { reason }),
    onSuccess: (_, approve) => (toast.success(approve ? "Approved" : "Sent back"), qc.invalidateQueries({ queryKey: ["timesheets"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = q.data?.sheet;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`${row.name}: ${q.data ? weekLabel(q.data.dates) : ""}`}
      width={900}
      footer={
        canApprove && s && (s.status === "submitted" || s.status === "approved") ? (
          rejecting ? (
            <><Button onClick={() => setRejecting(false)}>Back</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate(false)}>Send back</Button></>
          ) : (
            <><Button onClick={() => setRejecting(true)}>Send back</Button>{s.status === "submitted" ? <Button variant="primary" loading={act.isPending} onClick={() => act.mutate(true)}>Approve</Button> : null}</>
          )
        ) : <Button onClick={onClose}>Close</Button>
      }
    >
      {q.isLoading || !q.data ? <Loading /> : (
        <div className="flex flex-col gap-3">
          <WeekTable dates={q.data.dates} rows={q.data.rows} projects={q.data.projects} attendance={q.data.attendance} />
          {rejecting ? <Field label="What needs fixing (they see this)"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field> : null}
        </div>
      )}
    </Dialog>
  );
}

function Report() {
  const { can } = useSession();
  const [from, setFrom] = useState(addWeeks(todayIST().slice(0, 8) + "01", 0));
  const [to, setTo] = useState(todayIST());
  const q = useQuery({ queryKey: ["timesheets", "report", from, to], queryFn: () => api.get<{ projects: { projectId: string; code: string; name: string; client: string | null; minutes: number; billable: number; people: number }[]; people: { employeeId: string; name: string; code: string; minutes: number; billable: number }[] }>(`/admin/attendance/timesheets/report?from=${from}&to=${to}`) });
  const total = q.data?.projects.reduce((a, p) => a + p.minutes, 0) ?? 0;
  const max = Math.max(1, ...(q.data?.projects.map((p) => p.minutes) ?? []));
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex-1" />
        {can("attendance", "export") ? <Button onClick={() => download(`/admin/attendance/timesheets/report.xlsx?from=${from}&to=${to}`, "timesheets.xlsx").catch((e) => toast.error(errorMessage(e)))}><Download size={15} /> Export</Button> : null}
      </div>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="!gap-2.5">
          <CardHeader title="By project" sub={`${hoursLabel(total)} approved in this period`} />
          {!q.data?.projects.length ? <div className="text-muted text-[13px]">No approved hours in this period.</div> : null}
          {q.data?.projects.map((p) => (
            <div key={p.projectId} className="flex flex-col gap-1 text-[13px]">
              <div className="flex justify-between gap-2"><span><b>{p.code}</b> {p.name}{p.client ? <span className="text-muted"> · {p.client}</span> : null}</span><span className="num">{hoursLabel(p.minutes)}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--tint-1)]"><div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${(p.minutes / max) * 100}%` }} /></div>
              <div className="text-muted text-[12px]">{p.people} {p.people === 1 ? "person" : "people"} · {hoursLabel(p.billable)} billable</div>
            </div>
          ))}
        </Card>
        <Card className="!gap-1.5">
          <CardHeader title="By person" />
          {q.data?.people.map((p) => (
            <div key={p.employeeId} className="flex justify-between gap-2 border-b border-[var(--color-divider)] py-1.5 text-[13px] last:border-b-0">
              <span>{p.name} <span className="text-muted">({p.code})</span></span>
              <span className="num">{hoursLabel(p.minutes)} <span className="text-muted">· {p.minutes ? Math.round((p.billable / p.minutes) * 100) : 0}% billable</span></span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

interface ProjectRow extends Project { client: string | null; status: "active" | "archived"; approvedMinutes: number }
function Projects() {
  const q = useQuery({ queryKey: ["timesheets", "projects"], queryFn: () => api.get<ProjectRow[]>("/admin/attendance/timesheets/projects") });
  const [edit, setEdit] = useState<ProjectRow | "new" | null>(null);
  const columns = useMemo<ColumnDef<ProjectRow>[]>(
    () => [
      { id: "code", header: "Code", accessorKey: "code", cell: ({ getValue }) => <b>{getValue<string>()}</b> },
      { id: "name", header: "Project", accessorKey: "name", cell: ({ row: { original: p } }) => <div>{p.name}{p.client ? <div className="text-muted text-[12px]">{p.client}</div> : null}</div> },
      { id: "billable", header: "Billable", accessorKey: "billable", cell: ({ getValue }) => (getValue<boolean>() ? "Yes" : "No") },
      { id: "hours", header: "Approved hours", accessorKey: "approvedMinutes", cell: ({ getValue }) => <span className="num">{hoursLabel(getValue<number>())}</span> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ getValue }) => <Tag tone={getValue<string>() === "active" ? "ok" : "outline"}>{getValue<string>() === "active" ? "Active" : "Archived"}</Tag> },
    ],
    [],
  );
  return (
    <TableCard>
      <CardHeader className="py-2" title="Projects" sub="What people log their time against. Archive a project to stop new hours on it." actions={<Button variant="primary" onClick={() => setEdit("new")}><Plus size={15} /> Add project</Button>} />
      <DataTable data={q.data ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => setEdit(r)} storageKey="projects" empty="No projects yet." />
      {edit ? <ProjectDialog project={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
    </TableCard>
  );
}

function ProjectDialog({ project, onClose }: { project: ProjectRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: project?.code ?? "", name: project?.name ?? "", client: project?.client ?? "", billable: project?.billable ?? true, status: project?.status ?? "active" });
  const save = useMutation({
    mutationFn: () => (project ? api.put(`/admin/attendance/timesheets/projects/${project.id}`, { ...f, client: f.client || null }) : api.post("/admin/attendance/timesheets/projects", { ...f, client: f.client || null })),
    onSuccess: () => (toast.success("Saved"), qc.invalidateQueries({ queryKey: ["timesheets"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={project ? `Edit ${project.code}` : "Add a project"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.code.trim().length < 2 || f.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" hint="Short, e.g. WEB or ACME-01"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Client (optional)" span><Input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox checked={f.billable} onChange={(v) => setF({ ...f, billable: v })} label="Billable to the client" />
          {project ? <Checkbox checked={f.status === "archived"} onChange={(v) => setF({ ...f, status: v ? "archived" : "active" })} label="Archived (no new hours)" /> : null}
        </div>
      </div>
    </Dialog>
  );
}
