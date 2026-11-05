import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, todayIST } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Segmented } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/page";
import { PersonCell } from "@/components/ui/avatar";
import { StatusTag } from "@/components/ui/tag";
import { minsLabel, SOURCE_LABELS, DAY_SHORT, weekdayOf } from "@/components/attendance/shared";

interface Row {
  employeeId: string;
  code: string;
  name: string;
  department: string | null;
  designation: string | null;
  branch: string | null;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  source: string | null;
  lateMinutes: number;
  workMinutes: number;
  overtimeMinutes: number;
}
interface TodayRes {
  date: string;
  summary: { total: number; present: number; wfh: number; late: number; halfDay: number; absent: number; notMarked: number; onLeave: number; off: number };
  rows: Row[];
}

type Filter = "all" | "in" | "late" | "missing" | "leave";
const FILTERS: Record<Filter, (s: string | null) => boolean> = {
  all: (s) => s !== null,
  in: (s) => ["present", "late", "wfh", "half_day"].includes(s ?? ""),
  late: (s) => s === "late",
  missing: (s) => s === "absent" || s === "not_marked",
  leave: (s) => s === "on_leave",
};

export default function Today() {
  const [date, setDate] = useState(todayIST());
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const query = useQuery({ queryKey: ["attendance", "today", date], queryFn: () => api.get<TodayRes>(`/admin/attendance/today${qs({ date })}`) });
  const s = query.data?.summary;
  const isToday = date === todayIST();

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (query.data?.rows ?? []).filter((r) => FILTERS[filter](r.status) && (!t || `${r.name} ${r.code} ${r.department ?? ""}`.toLowerCase().includes(t)));
  }, [query.data, filter, q]);

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      { id: "name", header: "Employee", accessorFn: (r) => r.name, cell: ({ row }) => <PersonCell name={row.original.name} sub={`${row.original.code}${row.original.designation ? " · " + row.original.designation : ""}`} /> },
      { id: "department", header: "Department", accessorFn: (r) => r.department ?? "", cell: ({ getValue }) => getValue() || "—" },
      { id: "branch", header: "Branch", accessorFn: (r) => r.branch ?? "", cell: ({ getValue }) => getValue() || "—" },
      { id: "checkIn", header: "Check-in", accessorFn: (r) => r.checkIn ?? "", cell: ({ getValue }) => getValue() || "—" },
      { id: "checkOut", header: "Check-out", accessorFn: (r) => r.checkOut ?? "", cell: ({ getValue }) => getValue() || "—" },
      { id: "source", header: "Source", accessorFn: (r) => r.source ?? "", cell: ({ getValue }) => (getValue() ? SOURCE_LABELS[getValue() as string] ?? getValue() : "—") },
      { id: "late", header: "Late by", accessorFn: (r) => r.lateMinutes, cell: ({ getValue }) => <span style={{ color: getValue() ? "var(--warn-fg)" : undefined }}>{minsLabel(getValue() as number)}</span> },
      { id: "worked", header: "Worked", accessorFn: (r) => r.workMinutes, cell: ({ getValue }) => minsLabel(getValue() as number) },
      { id: "status", header: "Status", accessorFn: (r) => r.status ?? "", cell: ({ row }) => <StatusTag status={row.original.status} /> },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <StatCard label="Present" value={s?.present ?? "–"} meta={s ? `of ${s.total - s.off} expected` : undefined} onClick={() => setFilter("in")} />
        <StatCard label="Work from home" value={s?.wfh ?? "–"} meta="self-marked" />
        <StatCard label="Late" value={s?.late ?? "–"} meta={s?.halfDay ? `${s.halfDay} half day` : "after grace time"} onClick={() => setFilter("late")} />
        <StatCard label={isToday ? "Not marked yet" : "Absent"} value={s ? s.absent + s.notMarked : "–"} meta={isToday ? "no punch so far today" : "no punch or leave"} onClick={() => setFilter("missing")} />
        <StatCard label="On leave" value={s?.onLeave ?? "–"} meta="approved leave" onClick={() => setFilter("leave")} />
      </div>
      {query.error ? <ErrorState error={query.error} retry={() => query.refetch()} /> : null}
      <TableCard>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 pt-2">
          <div className="card-title text-[17px]">
            {isToday ? "Today" : "Day"} · {DAY_SHORT[weekdayOf(date)]} {fmtDate(date)}
          </div>
          <Input type="date" value={date} max={todayIST()} onChange={(e) => e.target.value && setDate(e.target.value)} className="!w-[170px]" aria-label="Date" />
        </div>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.employeeId}
          loading={query.isFetching}
          pageSize={15}
          storageKey="attendance-today"
          empty="No one matches this filter"
          toolbar={
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID or department" className="!w-[240px]" aria-label="Search" />
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "in", label: "Present" },
                  { value: "late", label: "Late" },
                  { value: "missing", label: isToday ? "Not marked" : "Absent" },
                  { value: "leave", label: "On leave" },
                ]}
              />
            </>
          }
        />
      </TableCard>
    </div>
  );
}
