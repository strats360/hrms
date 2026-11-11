import { hoursLabel } from "@hrms/shared";

export interface Project { id: string; code: string; name: string; client?: string | null; billable: boolean; archived?: boolean }
export interface Row { key: string; projectId: string; note: string; cells: Record<string, string> }
export const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });
export const weekLabel = (dates: string[]) => {
  const f = (iso: string, y = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(y ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `${f(dates[0]!)} to ${f(dates[6]!, true)}`;
};

/** Read-only week: projects down the side, days across, attendance underneath for comparison. */
export function WeekTable({ dates, rows, projects, attendance }: { dates: string[]; rows: { projectId: string; note: string; minutes: Record<string, number> }[]; projects: Project[]; attendance: Record<string, { minutes: number; status: string }> }) {
  const p = new Map(projects.map((x) => [x.id, x]));
  const day = (d: string) => rows.reduce((a, r) => a + (r.minutes[d] ?? 0), 0);
  const total = dates.reduce((a, d) => a + day(d), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="py-2 pr-3 font-medium">Project</th>
            {dates.map((d) => <th key={d} className="px-1 py-2 text-right font-medium">{dayLabel(d)}</th>)}
            <th className="py-2 pl-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--color-divider)]">
              <td className="py-2 pr-3"><div className="font-medium">{p.get(r.projectId)?.code} {p.get(r.projectId)?.name}</div>{r.note ? <div className="text-muted text-[12px]">{r.note}</div> : null}</td>
              {dates.map((d) => <td key={d} className="num px-1 py-2 text-right">{r.minutes[d] ? hoursLabel(r.minutes[d]!) : ""}</td>)}
              <td className="num py-2 pl-3 text-right font-medium">{hoursLabel(Object.values(r.minutes).reduce((a, b) => a + b, 0))}</td>
            </tr>
          ))}
          <tr className="border-t border-[var(--color-border)] font-medium">
            <td className="py-2 pr-3">Total</td>
            {dates.map((d) => <td key={d} className="num px-1 py-2 text-right">{day(d) ? hoursLabel(day(d)) : ""}</td>)}
            <td className="num py-2 pl-3 text-right">{hoursLabel(total)}</td>
          </tr>
          <tr className="text-muted">
            <td className="py-1 pr-3 text-[12px]">Attendance</td>
            {dates.map((d) => <td key={d} className="num px-1 py-1 text-right text-[12px]">{attendance[d]?.minutes ? hoursLabel(attendance[d]!.minutes) : attendance[d]?.status === "on_leave" ? "Leave" : ""}</td>)}
            <td className="num py-1 pl-3 text-right text-[12px]">{hoursLabel(dates.reduce((a, d) => a + (attendance[d]?.minutes ?? 0), 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
