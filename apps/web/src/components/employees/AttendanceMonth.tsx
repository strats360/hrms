import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ATTENDANCE_CODES, ATTENDANCE_STATUS_LABELS, todayIST, weekday, type AttendanceStatus } from "@hrms/shared";
import { Button } from "@/components/ui/button";
import { ErrorState, Loading } from "@/components/ui/page";
import { api, qs } from "@/lib/api";

interface Resp {
  month: string;
  days: string[];
  row: {
    days: (AttendanceStatus | "not_marked" | null)[];
    totals: { present: number; late: number; halfDay: number; absent: number; leave: number; off: number; paidDays: number };
  } | null;
}

const STYLE: Record<string, { bg: string; fg: string }> = {
  present: { bg: "var(--ok-bg)", fg: "var(--ok-fg)" },
  wfh: { bg: "var(--sel-bg)", fg: "var(--sel-fg)" },
  late: { bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  half_day: { bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  absent: { bg: "var(--bad-bg)", fg: "var(--bad-fg)" },
  on_leave: { bg: "var(--tint-2)", fg: "var(--color-text)" },
  holiday: { bg: "var(--tint-1)", fg: "var(--muted)" },
  weekly_off: { bg: "var(--tint-1)", fg: "var(--muted)" },
};

const shift = (month: string, d: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const dt = new Date(Date.UTC(y, m - 1 + d, 1));
  return dt.toISOString().slice(0, 7);
};

/** One employee's month as a small calendar with totals. */
export function AttendanceMonth({ employeeId }: { employeeId: string }) {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const q = useQuery({ queryKey: ["employee-attendance", employeeId, month], queryFn: () => api.get<Resp>(`/admin/attendance/employee/${employeeId}${qs({ month })}`) });
  const label = new Date(month + "-01T00:00:00Z").toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const days = q.data?.days ?? [];
  const lead = days.length ? (weekday(days[0]!) + 6) % 7 : 0; // Monday first
  const t = q.data?.row?.totals;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button icon size="sm" onClick={() => setMonth((m) => shift(m, -1))} aria-label="Previous month">
          <ChevronLeft size={16} />
        </Button>
        <div className="min-w-[130px] text-center font-medium">{label}</div>
        <Button icon size="sm" onClick={() => setMonth((m) => shift(m, 1))} disabled={month >= todayIST().slice(0, 7)} aria-label="Next month">
          <ChevronRight size={16} />
        </Button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !q.data?.row ? (
        <div className="text-muted text-[13px]">No attendance for this month. The employee may not be active yet.</div>
      ) : (
        <>
          <div className="grid max-w-[420px] grid-cols-7 gap-1 text-center text-[11px]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="text-muted">{d}</div>
            ))}
            {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} />)}
            {days.map((d, i) => {
              const s = q.data!.row!.days[i];
              const st = s && s !== "not_marked" ? STYLE[s] : undefined;
              return (
                <div
                  key={d}
                  title={`${d}: ${s ? (s === "not_marked" ? "Not marked" : ATTENDANCE_STATUS_LABELS[s]) : "—"}`}
                  className="flex aspect-square flex-col items-center justify-center rounded-[var(--radius-sm)]"
                  style={{ background: st?.bg ?? "transparent", color: st?.fg ?? "var(--muted)", border: st ? undefined : "1px dashed var(--color-divider)" }}
                >
                  <span className="num text-[11px] opacity-70">{Number(d.slice(8))}</span>
                  <span className="text-[10.5px] font-semibold">{s && s !== "not_marked" ? ATTENDANCE_CODES[s] : ""}</span>
                </div>
              );
            })}
          </div>
          {t ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
              <span>Present <b className="num font-semibold">{t.present}</b></span>
              <span>Late <b className="num font-semibold">{t.late}</b></span>
              <span>Half days <b className="num font-semibold">{t.halfDay}</b></span>
              <span>Absent <b className="num font-semibold">{t.absent}</b></span>
              <span>Leave <b className="num font-semibold">{t.leave}</b></span>
              <span>Paid days <b className="num font-semibold">{t.paidDays}</b></span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
