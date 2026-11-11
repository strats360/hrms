import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { CYCLE_STATUS_LABEL, DEFAULT_COMPETENCIES, fmtDate, todayIST, type CycleStatus } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, PageHeader } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";

export interface CycleRow {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  selfDue: string;
  managerDue: string;
  status: CycleStatus;
  competencies: string[];
  scope: { departmentIds: string[]; branchIds: string[]; joinedBy: string | null };
  counts?: Record<string, number>;
}
export const CYCLE_TONE: Record<CycleStatus, Tone> = { draft: "neutral", active: "accent", closed: "ok" };

function progress(c: CycleRow) {
  const n = Object.values(c.counts ?? {}).reduce((a, b) => a + b, 0);
  if (!n) return <span className="text-muted">—</span>;
  const done = (c.counts?.shared ?? 0) + (c.counts?.acknowledged ?? 0);
  return (
    <div className="min-w-[140px]">
      <div className="text-[13px]">{done} of {n} shared</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--tint-2,var(--color-divider))]">
        <div className="h-full bg-[var(--color-accent)]" style={{ width: `${Math.round((done / n) * 100)}%` }} />
      </div>
    </div>
  );
}

export default function Cycles() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["performance", "cycles"], queryFn: () => api.get<{ rows: CycleRow[]; canManage: boolean }>("/admin/performance/cycles") });
  const [creating, setCreating] = useState(false);
  const columns = useMemo<ColumnDef<CycleRow>[]>(
    () => [
      { id: "name", header: "Cycle", accessorKey: "name", cell: ({ row: { original: c } }) => <div><div className="font-medium">{c.name}</div><div className="text-muted text-[12px]">{fmtDate(c.periodStart)} to {fmtDate(c.periodEnd)}</div></div> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: c } }) => <Tag tone={CYCLE_TONE[c.status]}>{CYCLE_STATUS_LABEL[c.status]}</Tag> },
      { id: "due", header: "Due", enableSorting: false, cell: ({ row: { original: c } }) => <div className="text-[12.5px]">Self {fmtDate(c.selfDue)}<div className="text-muted">Manager {fmtDate(c.managerDue)}</div></div> },
      { id: "progress", header: "Progress", enableSorting: false, cell: ({ row: { original: c } }) => progress(c) },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Performance"
        sub="Review cycles: goals, self reviews, manager reviews and final ratings"
        actions={q.data?.canManage ? <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New review cycle</Button> : null}
      />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <CardHeader className="py-2" title="Review cycles" sub={q.data && !q.data.canManage ? "Cycles your team is part of. Open one to review your people." : undefined} />
        <DataTable data={q.data?.rows ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => nav(`/performance/${r.id}`)} storageKey="review-cycles" empty={q.data?.canManage ? "No review cycles yet. Start one to begin." : "None of your team is in a review cycle yet."} />
      </TableCard>
      {creating ? <CycleDialog onClose={() => setCreating(false)} onSaved={(id) => nav(`/performance/${id}`)} /> : null}
    </>
  );
}

function defaults(): Omit<CycleRow, "id" | "status" | "scope"> & { departmentIds: string[]; branchIds: string[]; joinedBy: string } {
  // the Indian financial year: April to March
  const today = todayIST();
  const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < "04" ? 1 : 0);
  const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return { name: `Annual review ${y}-${String(y + 1).slice(2)}`, periodStart: `${y}-04-01`, periodEnd: `${y + 1}-03-31`, selfDue: plus(14), managerDue: plus(28), competencies: DEFAULT_COMPETENCIES, departmentIds: [], branchIds: [], joinedBy: "" };
}

export function CycleDialog({ cycle, onClose, onSaved }: { cycle?: CycleRow; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api.get<{ departments: { id: string; name: string }[]; branches: { id: string; name: string }[] }>("/admin/org/lookups"), staleTime: 60_000 });
  const [f, setF] = useState(() => (cycle ? { ...cycle, ...cycle.scope, joinedBy: cycle.scope.joinedBy ?? "" } : defaults()));
  const [comp, setComp] = useState(f.competencies.join("\n"));
  const draft = !cycle || cycle.status === "draft";
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, periodStart: f.periodStart, periodEnd: f.periodEnd, selfDue: f.selfDue, managerDue: f.managerDue, competencies: comp.split("\n").map((s) => s.trim()).filter(Boolean), departmentIds: f.departmentIds, branchIds: f.branchIds, joinedBy: f.joinedBy || null };
      return cycle ? api.put<CycleRow>(`/admin/performance/cycles/${cycle.id}`, body) : api.post<CycleRow>("/admin/performance/cycles", body);
    },
    onSuccess: (c) => {
      toast.success(cycle ? "Cycle updated" : "Draft cycle saved. Check who's in it, then start it.");
      qc.invalidateQueries({ queryKey: ["performance"] });
      onClose();
      onSaved?.(c.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = (key: "departmentIds" | "branchIds", id: string) => setF({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={cycle ? `Edit ${cycle.name}` : "New review cycle"}
      description={draft ? "Saved as a draft. Nobody is told until you start it." : "The cycle has started, so the period and the people in it are fixed."}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{cycle ? "Save" : "Save draft"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Period from"><Input type="date" disabled={!draft} value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
          <Field label="Period to"><Input type="date" disabled={!draft} value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
          <Field label="Self reviews due"><Input type="date" value={f.selfDue} onChange={(e) => setF({ ...f, selfDue: e.target.value })} /></Field>
          <Field label="Manager reviews due"><Input type="date" value={f.managerDue} onChange={(e) => setF({ ...f, managerDue: e.target.value })} /></Field>
        </div>
        <Field label="Competencies" hint="One per line. Everyone is rated on these as well as their goals. Leave empty for goals only.">
          <Textarea rows={4} value={comp} onChange={(e) => setComp(e.target.value)} />
        </Field>
        {draft ? (
          <>
            <Field label="Who takes part" hint="Everyone currently employed, unless you pick departments or branches">
              <div className="flex flex-col gap-2">
                {lookups.data?.departments.length ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {lookups.data.departments.map((d) => <Checkbox key={d.id} checked={f.departmentIds.includes(d.id)} onChange={() => toggle("departmentIds", d.id)} label={d.name} />)}
                  </div>
                ) : null}
                {lookups.data && lookups.data.branches.length > 1 ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--color-divider)] pt-2">
                    {lookups.data.branches.map((b) => <Checkbox key={b.id} checked={f.branchIds.includes(b.id)} onChange={() => toggle("branchIds", b.id)} label={b.name} />)}
                  </div>
                ) : null}
              </div>
            </Field>
            <Field label="Joined on or before (optional)" hint="Leave out people who joined too recently to review. Defaults to the end of the period.">
              <Input type="date" value={f.joinedBy} onChange={(e) => setF({ ...f, joinedBy: e.target.value })} />
            </Field>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
