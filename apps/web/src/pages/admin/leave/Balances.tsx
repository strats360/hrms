import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { todayIST } from "@hrms/shared";
import { api, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { LeaveBalance } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/page";
import { PersonCell } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLookups } from "@/components/attendance/shared";
import { EncashDialog, EncashmentsCard, YearCloseDialog } from "@/components/leave/Encashment";
import { Notice } from "@/components/ui/page";

interface BalRow {
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  balances: LeaveBalance[];
}
interface BalRes {
  year: number;
  types: { id: string; code: string; name: string }[];
  rows: BalRow[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function Balances() {
  const { can } = useSession();
  const lookups = useLookups();
  const thisYear = Number(todayIST().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [departmentId, setDept] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [adjust, setAdjust] = useState<BalRow | null>(null);
  const [encash, setEncash] = useState<BalRow | null>(null);
  const [closing, setClosing] = useState<number | null>(null);
  const yearClose = useQuery({ queryKey: ["leave", "year-close"], queryFn: () => api.get<{ lastClosed: number | null; due: number | null }>("/admin/leave/year-close") });
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const query = useQuery({ queryKey: ["leave", "balances", year, departmentId, q], queryFn: () => api.get<BalRes>(`/admin/leave/balances${qs({ year, departmentId, q })}`) });
  const types = query.data?.types ?? [];

  const columns = useMemo<ColumnDef<BalRow, any>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.name, cell: ({ row }) => <PersonCell employeeId={row.original.employeeId} name={row.original.name} sub={`${row.original.code}${row.original.department ? " · " + row.original.department : ""}`} /> },
      ...types.map<ColumnDef<BalRow, any>>((t) => ({
        id: t.code,
        header: t.name,
        meta: { align: "right" },
        accessorFn: (r) => r.balances.find((b) => b.leaveTypeId === t.id)?.available ?? 0,
        cell: ({ row }) => {
          const b = row.original.balances.find((x) => x.leaveTypeId === t.id);
          if (!b) return "—";
          const total = b.opening + b.accrued + b.adjusted;
          return (
            <div title={`Opening ${fmt(b.opening)} · accrued ${fmt(b.accrued)} · adjusted ${fmt(b.adjusted)} · used ${fmt(b.used)} · pending ${fmt(b.pending)}`}>
              <div className="font-medium" style={{ color: b.available < 0 ? "var(--bad-fg)" : undefined }}>
                {fmt(b.available)}
                {b.isPaid && total > 0 ? <span className="text-muted font-normal"> / {fmt(total)}</span> : null}
              </div>
              <div className="text-muted text-[11.5px]">
                used {fmt(b.used)}
                {b.pending ? ` · pending ${fmt(b.pending)}` : ""}
              </div>
            </div>
          );
        },
      })),
      {
        id: "usedTotal",
        header: "Availed in year",
        meta: { align: "right" },
        accessorFn: (r) => r.balances.reduce((a, b) => a + b.used, 0),
        cell: ({ getValue }) => fmt(getValue() as number),
      },
    ],
    [types],
  );

  const due = yearClose.data?.due;
  return (
    <div className="flex flex-col gap-4">
      {query.error ? <ErrorState error={query.error} retry={() => query.refetch()} /> : null}
      {due && can("leave", "configure") ? (
        <Notice tone="sel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Leave year {due} isn't closed yet, so unused leave hasn't been carried into {due + 1}.</span>
            <Button size="sm" onClick={() => setClosing(due)}>
              Close {due}
            </Button>
          </div>
        </Notice>
      ) : null}
      <TableCard>
        <div className="pb-1 pt-2">
          <div className="card-title text-[17px]">Leave balances · {year}</div>
          <div className="text-muted text-[13px]">
            Available days after leave already taken. Hover a figure for the full breakdown.
            {yearClose.data?.lastClosed ? ` Leave year ${yearClose.data.lastClosed} is closed.` : ""}
            {can("leave", "configure") && !due && new Date().getMonth() === 11 ? (
              <button type="button" className="text-accent ml-1 underline" onClick={() => setClosing(thisYear)}>
                Close {thisYear}
              </button>
            ) : null}
          </div>
        </div>
        <DataTable
          data={query.data?.rows ?? []}
          columns={columns}
          getRowId={(r) => r.employeeId}
          loading={query.isFetching}
          pageSize={15}
          storageKey="leave-balances"
          toolbar={
            <>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee" className="!w-[200px]" aria-label="Search" />
              <Select value={departmentId} onChange={(e) => setDept(e.target.value)} className="!w-[180px]" aria-label="Department">
                <option value="">All departments</option>
                {lookups.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="!w-[110px]" aria-label="Year">
                {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </>
          }
          rowActions={
            can("leave", "configure")
              ? (r) => [
                  { label: "Adjust balance", onSelect: () => setAdjust(r) },
                  ...(year === thisYear ? [{ label: "Encash leave", onSelect: () => setEncash(r) }] : []),
                ]
              : undefined
          }
        />
      </TableCard>
      <EncashmentsCard />
      {encash ? <EncashDialog row={encash} onClose={() => setEncash(null)} /> : null}
      {closing ? <YearCloseDialog year={closing} onClose={() => setClosing(null)} /> : null}
      {adjust ? <AdjustDialog row={adjust} year={year} types={types} onClose={() => setAdjust(null)} /> : null}
    </div>
  );
}

function AdjustDialog({ row, year, types, onClose }: { row: BalRow; year: number; types: BalRes["types"]; onClose: () => void }) {
  const qc = useQueryClient();
  const [leaveTypeId, setType] = useState(types[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const cur = row.balances.find((b) => b.leaveTypeId === leaveTypeId);
  const d = Number(delta);
  const valid = delta !== "" && !Number.isNaN(d) && d !== 0 && Math.abs(d) <= 365 && note.trim().length > 0;
  const m = useMutation({
    mutationFn: () => api.post("/admin/leave/balances/adjust", { employeeId: row.employeeId, leaveTypeId, year, delta: d, note: note.trim() }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Balance adjusted");
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Adjust balance · ${row.name}`}
      description={`Add or remove days for ${year}. The change and your note are kept in the audit log.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Leave type">
          <Select value={leaveTypeId} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Days (+ to add, − to remove)" hint={cur ? `Available now: ${fmt(cur.available)}${valid ? `, after: ${fmt(cur.available + d)}` : ""}` : undefined}>
          <Input type="number" step="0.5" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="For example: 2 or -1" />
        </Field>
        <Field label="Note" span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="For example: comp off for working on Sat 31 Oct" />
        </Field>
      </div>
      {err ? (
        <div role="alert" className="text-[13px]" style={{ color: "var(--bad)" }}>
          {err}
        </div>
      ) : null}
    </Dialog>
  );
}
