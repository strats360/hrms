import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy, Moon, Wand2 } from "lucide-react";
import { todayIST } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { cn } from "@/lib/utils";

interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isDefault: boolean;
}
interface Cell {
  rostered: boolean;
  shiftId: string | null;
  isOff: boolean;
  holiday: boolean;
  leave: boolean;
  employed: boolean;
}
interface Row {
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  usualShiftId: string | null;
  cells: Record<string, Cell>;
}
interface RosterRes {
  days: string[];
  shifts: Shift[];
  rows: Row[];
  lockedUntil: string | null;
}

// one colour per shift, light and dark friendly (tints over the surface)
const TONES = ["#5d8bf4", "#e39b3b", "#9b6ee0", "#3fae7a", "#e0607e", "#3fb3c9", "#b58a3a"];
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return plus(iso, -((d.getUTCDay() + 6) % 7));
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const label = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return { dow: DOW[d.getUTCDay()]!, day: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) };
};
const overnight = (s: Shift) => s.endTime <= s.startTime;

export default function Roster() {
  const qc = useQueryClient();
  const { can } = useSession();
  const canPlan = can("attendance", "edit") || can("attendance", "approve");
  const [week, setWeek] = useState(() => monday(todayIST()));
  const [search, setSearch] = useState("");
  const [fill, setFill] = useState(false);
  const q = useQuery({ queryKey: ["roster", week], queryFn: () => api.get<RosterRes>(`/admin/attendance/roster?from=${week}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["roster"] });
  const save = useMutation({
    mutationFn: (entries: unknown[]) => api.put("/admin/attendance/roster", { entries }),
    onSuccess: refresh,
  });
  const copy = useMutation({
    mutationFn: () => api.post<{ saved: number }>("/admin/attendance/roster/copy-week", { fromWeek: plus(week, -7), toWeek: week, employeeIds: rows.map((r) => r.employeeId) }),
    onSuccess: (r) => (toast.success(`Copied ${r.saved} planned day${r.saved === 1 ? "" : "s"} from last week`), refresh()),
  });
  const d = q.data;
  const tone = useMemo(() => new Map((d?.shifts ?? []).map((s, i) => [s.id, TONES[i % TONES.length]!])), [d]);
  const rows = useMemo(() => (d?.rows ?? []).filter((r) => !search.trim() || `${r.name} ${r.code} ${r.department ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [d, search]);
  if (q.isLoading) return <Loading />;
  if (q.error || !d) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const today = todayIST();
  const shiftName = (id: string | null) => d.shifts.find((s) => s.id === id);
  const locked = (date: string) => !!d.lockedUntil && date <= d.lockedUntil;

  return (
    <div className="flex flex-col gap-4">
      <Card className="!gap-3 min-w-0">
        <CardHeader
          title="Shift roster"
          sub="Plan who works which shift, and who's off, day by day. Anything not planned follows the person's usual shift and weekly offs."
          actions={
            canPlan ? (
              <div className="flex flex-wrap gap-2">
                <Button loading={copy.isPending} onClick={() => copy.mutate()} title="Copy what was planned last week onto this week">
                  <Copy size={14} /> Copy last week
                </Button>
                <Button variant="primary" onClick={() => setFill(true)}>
                  <Wand2 size={14} /> Plan a stretch
                </Button>
              </div>
            ) : null
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button icon size="sm" aria-label="Previous week" onClick={() => setWeek(plus(week, -7))}>
              <ChevronLeft size={15} />
            </Button>
            <Button size="sm" onClick={() => setWeek(monday(today))}>This week</Button>
            <Button icon size="sm" aria-label="Next week" onClick={() => setWeek(plus(week, 7))}>
              <ChevronRight size={15} />
            </Button>
          </div>
          <div className="text-[13.5px] font-medium">
            {label(d.days[0]!).day} to {label(d.days.at(-1)!).day}
          </div>
          <Input className="!w-[220px] ml-auto" placeholder="Find a person" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a person" />
        </div>
        <div className="flex flex-wrap gap-2 text-[12px]">
          {d.shifts.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: tone.get(s.id) }} />
              {s.name} {s.startTime}–{s.endTime}
              {overnight(s) ? <Moon size={11} aria-label="overnight" /> : null}
            </span>
          ))}
          <span className="text-muted">· Dashed: their usual pattern, not planned</span>
        </div>
        {d.lockedUntil && d.days[0]! <= d.lockedUntil ? <Notice tone="sel">Payroll is locked up to {d.lockedUntil}, so those days can't change.</Notice> : null}

        <div className="scroll-thin -mx-1 min-w-0 overflow-x-auto px-1">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-[var(--color-surface)] px-2 py-2 text-left font-semibold">Employee</th>
                {d.days.map((day) => {
                  const l = label(day);
                  return (
                    <th key={day} className={cn("px-1 py-2 text-center font-semibold", day === today && "text-[var(--sel-fg)]")}>
                      <div className="text-[11px] uppercase tracking-[0.05em]">{l.dow}</div>
                      <div className="text-muted font-normal">{l.day}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="sticky left-0 z-[1] border-t border-[var(--color-divider)] bg-[var(--color-surface)] px-2 py-1.5">
                    <div className="flex min-w-[170px] items-center gap-2">
                      <Avatar employeeId={r.employeeId} name={r.name} size={26} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.name}</div>
                        <div className="text-muted truncate text-[11.5px]">{r.code}</div>
                      </div>
                    </div>
                  </td>
                  {d.days.map((day) => {
                    const c = r.cells[day]!;
                    const s = c.isOff ? null : shiftName(c.shiftId);
                    const color = s ? tone.get(s.id) : undefined;
                    const text = !c.employed ? "" : c.holiday ? "Holiday" : c.isOff ? "Off" : s ? s.startTime : "—";
                    const body = (
                      <button
                        type="button"
                        disabled={!canPlan || !c.employed || locked(day)}
                        className={cn(
                          "flex h-[38px] w-full min-w-[78px] cursor-pointer flex-col items-center justify-center rounded-[var(--radius-sm)] border text-[12px] leading-tight text-[var(--color-text)] disabled:cursor-default",
                          c.rostered ? "border-solid" : "border-dashed",
                          !c.employed && "opacity-30",
                        )}
                        style={{ background: color ? `color-mix(in srgb, ${color} ${c.rostered ? 26 : 12}%, transparent)` : "var(--tint-1)", borderColor: color ?? "var(--color-divider)" }}
                        aria-label={`${r.name}, ${label(day).dow} ${label(day).day}: ${c.isOff ? "day off" : (s?.name ?? "no shift")}${c.rostered ? ", planned" : ", usual pattern"}`}
                      >
                        <span className="font-medium">{text}</span>
                        {c.leave ? <span className="text-[10.5px] text-[var(--warn-fg)]">On leave</span> : s && !c.isOff ? <span className="text-muted text-[10.5px]">{s.name}</span> : null}
                      </button>
                    );
                    return (
                      <td key={day} className="border-t border-[var(--color-divider)] px-1 py-1.5">
                        {canPlan && c.employed && !locked(day) ? (
                          <Menu
                            align="start"
                            trigger={body}
                            items={[
                              ...d.shifts.map((sh) => ({ label: `${sh.name} · ${sh.startTime}–${sh.endTime}`, onSelect: () => save.mutate([{ employeeId: r.employeeId, date: day, shiftId: sh.id, isOff: false }]) })),
                              { label: "Day off", onSelect: () => save.mutate([{ employeeId: r.employeeId, date: day, shiftId: null, isOff: true }]) },
                              ...(c.rostered ? [{ label: "Back to their usual pattern", onSelect: () => save.mutate([{ employeeId: r.employeeId, date: day, clear: true }]) }] : []),
                            ]}
                          />
                        ) : (
                          body
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className="text-muted py-6 text-center">
                    Nobody to show.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
      {fill ? <FillDialog rows={rows} shifts={d.shifts} from={d.lockedUntil && week <= d.lockedUntil ? plus(d.lockedUntil, 1) : week} onClose={() => setFill(false)} onDone={refresh} /> : null}
    </div>
  );
}

function FillDialog({ rows, shifts, from, onClose, onDone }: { rows: Row[]; shifts: Shift[]; from: string; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(rows.map((r) => r.employeeId)));
  const [f, setF] = useState({ from, to: plus(from, 6), shiftId: shifts.find((s) => s.isDefault)?.id ?? shifts[0]?.id ?? "", offDays: [0] as number[] });
  const run = useMutation({
    mutationFn: () => api.post<{ saved: number }>("/admin/attendance/roster/fill", { employeeIds: [...picked], from: f.from, to: f.to, shiftId: f.shiftId, offDays: f.offDays }),
    onSuccess: (r) => {
      toast.success(`Planned ${r.saved} day${r.saved === 1 ? "" : "s"}`);
      onDone();
      onClose();
    },
  });
  const all = picked.size === rows.length;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      width={620}
      title="Plan a stretch"
      description="Everyone you pick works this shift from the start to the end date, with the chosen weekdays off. It replaces anything already planned on those days."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked.size || !f.shiftId || f.to < f.from} loading={run.isPending} onClick={() => run.mutate()}>
            Plan {picked.size} {picked.size === 1 ? "person" : "people"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From"><Input type="date" min={from} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Shift">
            <Select value={f.shiftId} onChange={(e) => setF({ ...f, shiftId: e.target.value })}>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.startTime}–{s.endTime}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Days off">
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5, 6, 0].map((w) => (
              <Checkbox key={w} label={DOW[w]!} checked={f.offDays.includes(w)} onChange={(v) => setF({ ...f, offDays: v ? [...f.offDays, w] : f.offDays.filter((x) => x !== w) })} />
            ))}
          </div>
        </Field>
        <Field label={`People (${picked.size} of ${rows.length})`}>
          <div className="scroll-thin max-h-[200px] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-divider)] p-2">
            <Checkbox label="Everyone shown" checked={all} indeterminate={!all && picked.size > 0} onChange={(v) => setPicked(new Set(v ? rows.map((r) => r.employeeId) : []))} />
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {rows.map((r) => (
                <Checkbox key={r.employeeId} label={`${r.name} · ${r.code}`} checked={picked.has(r.employeeId)} onChange={(v) => setPicked((p) => (v ? new Set([...p, r.employeeId]) : new Set([...p].filter((x) => x !== r.employeeId))))} />
              ))}
            </div>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
