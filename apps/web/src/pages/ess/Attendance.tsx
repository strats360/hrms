import { useEffect, useState } from "react";
import { MyShifts } from "@/components/ess/MyShifts";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS, correctionCreateSchema, fmtDate, todayIST, type AttendanceStatus } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { hoursMinutes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";
import { StatusTag, statusLabel } from "@/components/ui/tag";
import { zodErrors } from "@/components/onboarding/form";

interface Day {
  date: string;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  workMinutes: number;
  source: string | null;
}
interface Correction {
  id: string;
  date: string;
  issue: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  requestedStatus: string | null;
  status: string;
  reviewNote: string | null;
}

const COLORS: Record<string, { bg: string; fg: string }> = {
  present: { bg: "var(--ok-bg)", fg: "var(--ok-fg)" },
  wfh: { bg: "var(--sel-bg)", fg: "var(--sel-fg)" },
  late: { bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  half_day: { bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  absent: { bg: "var(--bad-bg)", fg: "var(--bad-fg)" },
  on_leave: { bg: "var(--tint-2)", fg: "var(--color-text)" },
  holiday: { bg: "var(--tint-1)", fg: "var(--muted)" },
  weekly_off: { bg: "transparent", fg: "var(--muted)" },
  not_marked: { bg: "transparent", fg: "var(--muted)" },
};
const SOURCE: Record<string, string> = { ip: "Office IP", gps: "GPS", wfh: "WFH", web: "Web", mobile: "Mobile", biometric: "Biometric", manual: "HR entry", import: "Import" };
const ISSUES = ["Missed punch-out", "Missed punch-in", "Biometric failed", "WFH not marked", "Other"];

function shiftMonth(m: string, d: number) {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const dt = new Date(Date.UTC(y, mo - 1 + d, 1));
  return dt.toISOString().slice(0, 7);
}
const monthLabel = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export default function EssAttendance() {
  const [params, setParams] = useSearchParams();
  const thisMonth = todayIST().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [open, setOpen] = useState(params.get("correct") === "1");
  const [prefillDate, setPrefillDate] = useState<string | undefined>();
  const q = useQuery({ queryKey: ["ess", "attendance", month], queryFn: () => api.get<{ month: string; days: Day[]; corrections: Correction[] }>(`/ess/attendance${qs({ month })}`) });

  useEffect(() => {
    if (params.get("correct") && !open) setParams({}, { replace: true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = q.data?.days ?? [];
  const count = (...s: string[]) => days.filter((d) => d.status && s.includes(d.status)).length;
  const firstDow = days[0] ? (new Date(days[0].date + "T00:00:00Z").getUTCDay() + 6) % 7 : 0; // Monday first

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="!mb-0 !text-[24px]">Attendance</h1>
        <Button variant="primary" onClick={() => { setPrefillDate(undefined); setOpen(true); }}>
          <Plus size={15} />
          Request correction
        </Button>
      </div>
      <MyShifts />
      <div className="flex items-center gap-2">
        <Button icon size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month"><ChevronLeft size={16} /></Button>
        <div className="min-w-[130px] text-center font-medium">{monthLabel(month)}</div>
        <Button icon size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth} aria-label="Next month"><ChevronRight size={16} /></Button>
      </div>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <StatCard label="Present" value={count("present", "late", "half_day")} />
            <StatCard label="Late" value={count("late")} />
            <StatCard label="WFH" value={count("wfh")} />
            <StatCard label="Leave" value={count("on_leave")} />
            <StatCard label="Absent" value={count("absent")} className="col-span-2 sm:col-span-1" />
          </div>
          <Card className="!gap-2 !p-3 sm:!p-[22px]">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--muted)" }}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
              {days.map((d) => {
                const c = d.status ? COLORS[d.status] ?? COLORS.not_marked! : { bg: "transparent", fg: "var(--muted)" };
                const canCorrect = d.date <= todayIST() && d.status !== "holiday" && d.status !== "weekly_off" && d.status !== null;
                return (
                  <button
                    key={d.date}
                    type="button"
                    disabled={!canCorrect}
                    onClick={() => { setPrefillDate(d.date); setOpen(true); }}
                    title={`${fmtDate(d.date)}: ${d.status ? statusLabel(d.status) : "No record"}${d.checkIn ? ` · ${d.checkIn} to ${d.checkOut ?? "…"}` : ""}`}
                    className="flex min-h-[54px] flex-col items-start gap-0.5 rounded-[var(--radius-sm)] border p-1.5 text-left sm:min-h-[72px]"
                    style={{ background: c.bg, color: c.fg, borderColor: d.date === todayIST() ? "var(--color-accent)" : "var(--color-divider)", cursor: canCorrect ? "pointer" : "default" }}
                  >
                    <span className="text-[12px] font-semibold">{Number(d.date.slice(8))}</span>
                    {d.status ? <span className="hidden text-[10.5px] leading-tight sm:block">{statusLabel(d.status)}</span> : null}
                    {d.checkIn ? <span className="text-[10px] leading-tight opacity-90 num">{d.checkIn}{d.checkOut ? `–${d.checkOut}` : ""}</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="text-muted text-[12px]">Tap a day to request a correction for it.</div>
          </Card>
          <Card className="!gap-1.5">
            <CardHeader title="Daily log" />
            {[...days].reverse().filter((d) => d.checkIn).slice(0, 10).map((d) => (
              <div key={d.date} className="flex justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-[13px]" style={{ background: "var(--color-surface)" }}>
                <span>{fmtDate(d.date, false)}</span>
                <span className="num text-right">{d.checkIn} to {d.checkOut ?? "now"}{d.workMinutes ? ` · ${hoursMinutes(d.workMinutes)}` : ""}{d.source ? ` · ${SOURCE[d.source] ?? d.source}` : ""}</span>
              </div>
            ))}
            {days.every((d) => !d.checkIn) ? <div className="text-muted text-[13px]">No check-ins this month.</div> : null}
          </Card>
          <Card className="!gap-1.5">
            <CardHeader title="My correction requests" />
            {q.data!.corrections.length === 0 ? <div className="text-muted text-[13px]">None this month.</div> : null}
            {q.data!.corrections.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 border-b border-[var(--color-divider)] py-2 text-[13px] last:border-0">
                <div className="min-w-0">
                  <div className="font-medium">{fmtDate(c.date)} · {c.issue}</div>
                  <div className="text-muted text-[12px]">
                    {[c.requestedCheckIn && `In ${c.requestedCheckIn}`, c.requestedCheckOut && `Out ${c.requestedCheckOut}`, c.requestedStatus && statusLabel(c.requestedStatus)].filter(Boolean).join(" · ")}
                    {c.reviewNote ? ` · Note: ${c.reviewNote}` : ""}
                  </div>
                </div>
                <StatusTag status={c.status} />
              </div>
            ))}
          </Card>
        </>
      )}
      <CorrectionDialog open={open} onOpenChange={setOpen} date={prefillDate} />
    </>
  );
}

function CorrectionDialog({ open, onOpenChange, date }: { open: boolean; onOpenChange: (v: boolean) => void; date?: string }) {
  const qc = useQueryClient();
  const blank = () => ({ date: date ?? todayIST(), issue: ISSUES[0]!, requestedCheckIn: "", requestedCheckOut: "", requestedStatus: "", reason: "" });
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setF(blank());
      setErrors({});
    }
  }, [open, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: (b: unknown) => api.post("/ess/attendance/corrections", b),
    onSuccess: () => {
      toast.success("Correction sent to your manager");
      qc.invalidateQueries({ queryKey: ["ess"] });
      onOpenChange(false);
    },
  });
  const submit = () => {
    const parsed = correctionCreateSchema.safeParse(f);
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    if (!f.requestedCheckIn && !f.requestedCheckOut && !f.requestedStatus) return setErrors({ requestedCheckIn: "Enter a time or pick a status" });
    setErrors({});
    m.mutate(parsed.data);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request attendance correction"
      description="Your manager or HR will review it."
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={submit}>Send request</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" error={errors.date}>
          <Input type="date" value={f.date} max={todayIST()} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="What happened">
          <Select value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value, requestedStatus: e.target.value === "WFH not marked" ? "wfh" : f.requestedStatus })}>
            {ISSUES.map((i) => <option key={i}>{i}</option>)}
          </Select>
        </Field>
        <Field label="Correct check-in" error={errors.requestedCheckIn}>
          <Input type="time" value={f.requestedCheckIn} onChange={(e) => setF({ ...f, requestedCheckIn: e.target.value })} />
        </Field>
        <Field label="Correct check-out" error={errors.requestedCheckOut}>
          <Input type="time" value={f.requestedCheckOut} onChange={(e) => setF({ ...f, requestedCheckOut: e.target.value })} />
        </Field>
        <Field span label="Mark the day as (optional)">
          <Select value={f.requestedStatus} onChange={(e) => setF({ ...f, requestedStatus: e.target.value })}>
            <option value="">Work it out from the times</option>
            {ATTENDANCE_STATUSES.filter((s) => ["present", "wfh", "half_day"].includes(s)).map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s as AttendanceStatus]}</option>)}
          </Select>
        </Field>
        <Field span label="Reason" error={errors.reason}>
          <Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} placeholder="For example: the biometric device didn't read my finger" />
        </Field>
      </div>
    </Dialog>
  );
}
