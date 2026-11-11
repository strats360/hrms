import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { addWeeks, fmtDate, hoursLabel, parseHours, TIMESHEET_STATUS_LABEL, type TimesheetStatus } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { dayLabel, weekLabel, WeekTable, type Project, type Row } from "@/components/timesheets/Grid";

interface Data {
  week: string;
  dates: string[];
  current: string;
  sheet: { id: string; status: TimesheetStatus; totalMinutes: number; submittedAt: string | null; decidedBy: string | null; decidedAt: string | null; rejectReason: string | null } | null;
  rows: { projectId: string; note: string; minutes: Record<string, number> }[];
  projects: Project[];
  attendance: Record<string, { minutes: number; status: string }>;
  recent: { weekStart: string; status: TimesheetStatus; totalMinutes: number }[];
}
export const SHEET_TONE: Record<TimesheetStatus | "missing", Tone> = { draft: "neutral", submitted: "warn", approved: "ok", rejected: "bad", missing: "outline" };
const fmtCell = (m: number) => (m ? (m % 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : String(m / 60)) : "");

export default function EssTimesheets() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const week = params.get("week") ?? "";
  const q = useQuery({ queryKey: ["timesheets", "mine", week], queryFn: () => api.get<Data>(`/ess/timesheets${week ? `?week=${week}` : ""}`) });
  const d = q.data;
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!d) return;
    setRows(d.rows.length ? d.rows.map((r, i) => ({ key: `${i}`, projectId: r.projectId, note: r.note, cells: Object.fromEntries(Object.entries(r.minutes).map(([k, m]) => [k, fmtCell(m)])) })) : d.projects[0] ? [{ key: "new", projectId: d.projects[0].id, note: "", cells: {} }] : []);
  }, [d]);
  const parsed = useMemo(() => rows.map((r) => ({ ...r, minutes: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, parseHours(v)])) })), [rows]);
  const bad = parsed.some((r) => Object.values(r.minutes).some((m) => m === null));
  const dayTotal = (date: string) => parsed.reduce((a, r) => a + (r.minutes[date] ?? 0), 0);
  const save = useMutation({
    mutationFn: (submit: boolean) => api.put(`/ess/timesheets/${d!.week}`, { rows: parsed.map((r) => ({ projectId: r.projectId, note: r.note, minutes: Object.fromEntries(Object.entries(r.minutes).filter(([, m]) => (m ?? 0) > 0)) })), submit }),
    onSuccess: (_, submit) => (toast.success(submit ? "Submitted to your manager" : "Saved"), qc.invalidateQueries({ queryKey: ["timesheets", "mine"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !d) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const go = (w: string) => setParams({ week: w });
  const locked = d.sheet?.status === "submitted" || d.sheet?.status === "approved";
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = d.dates.reduce((a, x) => a + dayTotal(x), 0);
  return (
    <>
      <div>
        <h1 className="!mb-1 text-[26px]">Timesheets</h1>
        <div className="text-muted text-[13.5px]">Log your hours by project each week and submit them to your manager.</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon size="sm" aria-label="Previous week" onClick={() => go(addWeeks(d.week, -1))}><ChevronLeft size={16} /></Button>
        <div className="min-w-[190px] text-center font-medium">{weekLabel(d.dates)}</div>
        <Button icon size="sm" aria-label="Next week" disabled={d.week >= d.current} onClick={() => go(addWeeks(d.week, 1))}><ChevronRight size={16} /></Button>
        {d.week !== d.current ? <Button size="sm" variant="ghost" onClick={() => go(d.current)}>This week</Button> : null}
        <Tag tone={SHEET_TONE[d.sheet?.status ?? "missing"]}>{d.sheet ? TIMESHEET_STATUS_LABEL[d.sheet.status] : "Not started"}</Tag>
      </div>
      {d.sheet?.status === "rejected" ? <Notice tone="bad">{d.sheet.decidedBy} sent this back: {d.sheet.rejectReason}</Notice> : null}
      {d.sheet?.status === "approved" ? <Notice tone="ok">Approved by {d.sheet.decidedBy} on {fmtDate(d.sheet.decidedAt!.slice(0, 10))}.</Notice> : null}
      {d.sheet?.status === "submitted" ? <Notice tone="sel">Submitted {fmtDate(d.sheet.submittedAt!.slice(0, 10))}. Your manager will approve it or send it back.</Notice> : null}
      {!d.projects.length ? (
        <Card><Empty title="No projects yet" sub="HR adds the projects you log time against." /></Card>
      ) : locked ? (
        <Card className="!gap-2"><WeekTable dates={d.dates} rows={d.rows} projects={d.projects} attendance={d.attendance} /></Card>
      ) : (
        <Card className="!gap-3">
          <CardHeader title="Hours" sub="Type 7.5, 7:30 or 7h30. Leave a day empty if you didn't work on it." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="text-muted text-left text-[12px]">
                  <th className="py-2 pr-2 font-medium">Project and what you did</th>
                  {d.dates.map((x) => <th key={x} className="w-[62px] px-1 py-2 text-center font-medium">{dayLabel(x)}</th>)}
                  <th className="w-[76px] py-2 pl-2 text-right font-medium">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {parsed.map((r, i) => (
                  <tr key={r.key} className="border-t border-[var(--color-divider)] align-top">
                    <td className="py-2 pr-2">
                      <div className="flex flex-col gap-1.5">
                        <Select aria-label={`Project for row ${i + 1}`} value={r.projectId} onChange={(e) => set(i, { projectId: e.target.value })}>
                          {d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}{p.archived ? " (archived)" : ""}</option>)}
                        </Select>
                        <Input aria-label={`What you did, row ${i + 1}`} placeholder="What you worked on (optional)" value={r.note} onChange={(e) => set(i, { note: e.target.value })} maxLength={300} />
                      </div>
                    </td>
                    {d.dates.map((x) => (
                      <td key={x} className="px-1 py-2">
                        <Input aria-label={`${dayLabel(x)} hours, row ${i + 1}`} inputMode="decimal" className={`!px-1.5 text-center ${r.minutes[x] === null ? "!border-[var(--bad)]" : ""}`} value={rows[i]!.cells[x] ?? ""} onChange={(e) => set(i, { cells: { ...rows[i]!.cells, [x]: e.target.value } })} />
                      </td>
                    ))}
                    <td className="num whitespace-nowrap py-3 pl-2 text-right font-medium">{hoursLabel(Object.values(r.minutes).reduce<number>((a, b) => a + (b ?? 0), 0))}</td>
                    <td className="py-2"><Button icon variant="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></Button></td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--color-border)] font-medium">
                  <td className="py-2 pr-2">Total</td>
                  {d.dates.map((x) => <td key={x} className={`num px-1 py-2 text-center ${dayTotal(x) > 24 * 60 ? "text-[var(--bad)]" : ""}`}>{dayTotal(x) ? hoursLabel(dayTotal(x)) : ""}</td>)}
                  <td className="num whitespace-nowrap py-2 pl-2 text-right">{hoursLabel(total)}</td>
                  <td />
                </tr>
                <tr className="text-muted">
                  <td className="py-1 pr-2 text-[12px]">Attendance</td>
                  {d.dates.map((x) => <td key={x} className="num px-1 py-1 text-center text-[12px]">{d.attendance[x]?.minutes ? hoursLabel(d.attendance[x]!.minutes) : d.attendance[x]?.status === "on_leave" ? "Leave" : ""}</td>)}
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" onClick={() => setRows([...rows, { key: crypto.randomUUID(), projectId: d.projects[0]!.id, note: "", cells: {} }])}><Plus size={14} /> Add row</Button>
            <div className="flex gap-2">
              <Button disabled={bad} loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>Save</Button>
              <Button variant="primary" disabled={bad || !total} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Submit week</Button>
            </div>
          </div>
          {bad ? <div className="text-[12.5px] text-[var(--bad)]">Some hours can't be read. Use 7.5, 7:30 or 7h30.</div> : null}
        </Card>
      )}
      {d.recent.length ? (
        <Card className="!gap-1">
          <CardHeader title="Recent weeks" />
          {d.recent.map((r) => (
            <button key={r.weekStart} type="button" onClick={() => go(r.weekStart)} className="flex items-center justify-between gap-2 border-b border-[var(--color-divider)] py-2 text-left text-[13.5px] last:border-b-0">
              <span>Week of {fmtDate(r.weekStart)}</span>
              <span className="flex items-center gap-3"><span className="num text-muted">{hoursLabel(r.totalMinutes)}</span><Tag tone={SHEET_TONE[r.status]}>{TIMESHEET_STATUS_LABEL[r.status]}</Tag></span>
            </button>
          ))}
        </Card>
      ) : null}
    </>
  );
}
