import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { toast } from "sonner";
import { ATTENDANCE_CODES, ATTENDANCE_STATUS_LABELS, todayIST, type AttendanceStatus } from "@hrms/shared";
import { api, download, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";
import { useLookups, weekdayOf, DAY_SHORT } from "@/components/attendance/shared";

interface MonthRow {
  employeeId: string;
  code: string;
  name: string;
  department: string | null;
  days: (string | null)[];
  totals: { present: number; late: number; halfDay: number; absent: number; leave: number; off: number; paidDays: number };
}
interface MonthRes {
  month: string;
  days: string[];
  rows: MonthRow[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function cellStyle(s: string | null): { bg: string; fg: string } {
  switch (s) {
    case "present":
      return { bg: "var(--ok-bg)", fg: "var(--ok-fg)" };
    case "wfh":
      return { bg: "var(--sel-bg)", fg: "var(--sel-fg)" };
    case "late":
    case "half_day":
      return { bg: "var(--warn-bg)", fg: "var(--warn-fg)" };
    case "absent":
      return { bg: "var(--bad-bg)", fg: "var(--bad-fg)" };
    case "on_leave":
    case "holiday":
    case "weekly_off":
      return { bg: "var(--tint-2)", fg: "var(--muted-2)" };
    default:
      return { bg: "transparent", fg: "var(--muted)" };
  }
}

function shift(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const LEGEND: AttendanceStatus[] = ["present", "late", "half_day", "absent", "on_leave", "wfh", "holiday", "weekly_off"];
const th = "px-2 py-1.5 text-[11px] uppercase tracking-[0.06em] font-normal whitespace-nowrap";

export default function Monthly() {
  const { can } = useSession();
  const lookups = useLookups();
  const current = todayIST().slice(0, 7);
  const [month, setMonth] = useState(current);
  const [departmentId, setDept] = useState("");
  const [q, setQ] = useState("");
  const query = useQuery({ queryKey: ["attendance", "monthly", month, departmentId], queryFn: () => api.get<MonthRes>(`/admin/attendance/monthly${qs({ month, departmentId })}`) });
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (query.data?.rows ?? []).filter((r) => !t || `${r.name} ${r.code}`.toLowerCase().includes(t));
  }, [query.data, q]);
  const [y, m] = month.split("-").map(Number) as [number, number];

  return (
    <div className="card min-w-0 gap-3 bg-[var(--color-surface)] !p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button icon onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">
            <ChevronLeft size={16} />
          </Button>
          <div className="card-title min-w-[140px] text-center text-[17px]">
            {MONTHS[m - 1]} {y}
          </div>
          <Button icon onClick={() => setMonth(shift(month, 1))} disabled={month >= current} aria-label="Next month">
            <ChevronRight size={16} />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="month" value={month} max={current} onChange={(e) => e.target.value && setMonth(e.target.value)} className="!w-[160px]" aria-label="Month" />
          <Select value={departmentId} onChange={(e) => setDept(e.target.value)} className="!w-[180px]" aria-label="Department">
            <option value="">All departments</option>
            {lookups.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee" className="!w-[180px]" aria-label="Search" />
          {can("attendance", "export") ? (
            <Button onClick={() => download(`/admin/attendance/monthly.csv${qs({ month, departmentId })}`, `attendance-${month}.csv`).catch((e) => toast.error(errorMessage(e)))}>
              <Download size={16} />
              Export
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[12px]">
        {LEGEND.map((s) => {
          const c = cellStyle(s);
          return (
            <span key={s} className="tag" style={{ background: c.bg, color: c.fg }}>
              {ATTENDANCE_CODES[s]} {ATTENDANCE_STATUS_LABELS[s]}
            </span>
          );
        })}
      </div>
      {query.error ? <ErrorState error={query.error} retry={() => query.refetch()} /> : null}
      {query.isLoading ? (
        <Loading />
      ) : (
        <div className="scroll-thin min-w-0 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]" style={{ minWidth: 1100 }}>
            <thead>
              <tr style={{ color: "var(--muted)" }}>
                <th className={`${th} sticky left-0 z-[1] text-left`} style={{ background: "var(--color-surface)" }}>
                  Employee
                </th>
                {query.data?.days.map((d) => {
                  const wd = weekdayOf(d);
                  return (
                    <th key={d} className="w-7 px-0 py-1 text-center font-medium leading-tight" style={{ background: wd === 0 || wd === 6 ? "var(--tint-1)" : undefined }}>
                      <div className="text-[9px]">{DAY_SHORT[wd]!.slice(0, 2)}</div>
                      {Number(d.slice(8))}
                    </th>
                  );
                })}
                {["Present", "Late", "Half", "Absent", "Leave", "Paid days"].map((h) => (
                  <th key={h} className={`${th} text-right`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} style={{ borderTop: "1px solid var(--color-divider)" }}>
                  <td className="sticky left-0 z-[1] whitespace-nowrap px-2 py-1.5" style={{ background: "var(--color-surface)" }}>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-muted text-[11px]">
                      {r.code}
                      {r.department ? ` · ${r.department}` : ""}
                    </div>
                  </td>
                  {r.days.map((s, i) => {
                    const c = cellStyle(s);
                    const d = query.data!.days[i]!;
                    const wd = weekdayOf(d);
                    const label = s && s !== "not_marked" ? ATTENDANCE_STATUS_LABELS[s as AttendanceStatus] : s === "not_marked" ? "Not marked" : "";
                    return (
                      <td key={d} className="px-px py-0.5 text-center" style={{ background: wd === 0 || wd === 6 ? "var(--tint-1)" : undefined }}>
                        <div title={label ? `${d}: ${label}` : d} className="grid h-[26px] place-items-center rounded-[7px] text-[10.5px] font-semibold" style={{ background: c.bg, color: c.fg }}>
                          {s && s !== "not_marked" ? ATTENDANCE_CODES[s as AttendanceStatus] : ""}
                        </div>
                      </td>
                    );
                  })}
                  <td className="num px-2 text-right font-semibold">{r.totals.present}</td>
                  <td className="num px-2 text-right" style={{ color: r.totals.late ? "var(--warn-fg)" : undefined }}>{r.totals.late}</td>
                  <td className="num px-2 text-right">{r.totals.halfDay}</td>
                  <td className="num px-2 text-right" style={{ color: r.totals.absent ? "var(--bad-fg)" : undefined }}>{r.totals.absent}</td>
                  <td className="num px-2 text-right">{r.totals.leave}</td>
                  <td className="num px-2 text-right font-semibold">{r.totals.paidDays}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={(query.data?.days.length ?? 0) + 7} className="text-muted py-8 text-center">
                    No employees to show
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-muted text-[12px]">Paid days count present days (half days as 0.5), approved leave, weekly offs and holidays. Days before joining are left blank.</div>
    </div>
  );
}
