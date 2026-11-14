import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, holidaySchema, todayIST } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Holiday } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLookups, DAY_SHORT, weekdayOf } from "@/components/attendance/shared";
import { confirmAction } from "@/components/ui/confirm";

const TYPE: Record<string, { label: string; tone: Tone }> = {
  national: { label: "National", tone: "accent" },
  festival: { label: "Festival", tone: "ok" },
  optional: { label: "Restricted", tone: "warn" },
  company: { label: "Company", tone: "neutral" },
};

export default function Holidays() {
  const { can } = useSession();
  const qc = useQueryClient();
  const lookups = useLookups();
  const thisYear = Number(todayIST().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [adding, setAdding] = useState(false);
  const editable = can("leave", "configure");
  const query = useQuery({ queryKey: ["leave", "holidays", String(year)], queryFn: () => api.get<Holiday[]>(`/admin/leave/holidays?year=${year}`) });
  const branchName = (id: string | null) => (id ? (lookups.data?.branches.find((b) => b.id === id)?.name ?? "One branch") : "All branches");
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/leave/holidays/${id}`),
    onSuccess: () => {
      toast.success("Holiday removed");
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
  });

  const columns = useMemo<ColumnDef<Holiday, any>[]>(
    () => [
      { id: "date", header: "Date", accessorFn: (r) => r.date, cell: ({ getValue }) => <span className="font-semibold">{fmtDate(getValue() as string)}</span> },
      { id: "day", header: "Day", accessorFn: (r) => weekdayOf(r.date), cell: ({ row }) => DAY_SHORT[weekdayOf(row.original.date)] },
      { id: "name", header: "Holiday", accessorFn: (r) => r.name },
      { id: "type", header: "Type", accessorFn: (r) => r.type, cell: ({ getValue }) => <Tag tone={TYPE[getValue() as string]?.tone ?? "neutral"}>{TYPE[getValue() as string]?.label ?? getValue()}</Tag> },
      { id: "branch", header: "Applies to", accessorFn: (r) => branchName(r.branchId), cell: ({ getValue }) => <span className="text-muted">{getValue() as string}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookups.data],
  );
  const rows = query.data ?? [];
  const upcoming = rows.filter((h) => h.date >= todayIST()).length;

  return (
    <div className="flex flex-col gap-4">
      {query.error ? <ErrorState error={query.error} retry={() => query.refetch()} /> : null}
      <TableCard>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 pt-2">
          <div>
            <div className="card-title text-[17px]">Holiday calendar {year}</div>
            <div className="text-muted text-[13px]">
              {rows.length} declared{year === thisYear ? ` · ${upcoming} still to come` : ""}
            </div>
          </div>
          {editable ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={16} />
              Add holiday
            </Button>
          ) : null}
        </div>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          loading={query.isFetching}
          pageSize={25}
          initialSort={[{ id: "date", desc: false }]}
          columnToggle={false}
          empty="No holidays declared for this year yet"
          toolbar={
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="!w-[110px]" aria-label="Year">
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          }
          rowActions={
            editable
              ? (h) => [
                  {
                    label: "Remove holiday",
                    danger: true,
                    onSelect: () => {
                      void confirmAction({ title: `Remove ${h.name}?`, body: `It will no longer be a holiday on ${fmtDate(h.date)}.`, confirmLabel: "Remove", danger: true }).then((ok) => ok && del.mutate(h.id));
                    },
                  },
                ]
              : undefined
          }
        />
      </TableCard>
      {adding ? <AddHolidayDialog year={year} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function AddHolidayDialog({ year, onClose }: { year: number; onClose: () => void }) {
  const qc = useQueryClient();
  const lookups = useLookups();
  const [f, setF] = useState({ date: `${year}-01-01` > todayIST() ? `${year}-01-01` : todayIST(), name: "", type: "festival", branchId: "" });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: unknown) => api.post("/admin/leave/holidays", body),
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Holiday added");
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      onClose();
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const submit = () => {
    const p = holidaySchema.safeParse({ ...f, branchId: f.branchId || null });
    if (!p.success) return setErr(p.error.issues[0]?.message ?? "Check the form");
    setErr(null);
    m.mutate(p.data);
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Add holiday"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!f.name.trim()} onClick={submit}>
            Add holiday
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Holiday name" span>
          <Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="For example: Janmashtami" maxLength={120} />
        </Field>
        <Field label="Date">
          <Input type="date" value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => setF((s) => ({ ...s, type: e.target.value }))}>
            {Object.entries(TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Applies to" span>
          <Select value={f.branchId} onChange={(e) => setF((s) => ({ ...s, branchId: e.target.value }))}>
            <option value="">All branches</option>
            {lookups.data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
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
