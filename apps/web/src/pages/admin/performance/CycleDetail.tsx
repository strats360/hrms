import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ChevronLeft, Download, Pencil } from "lucide-react";
import { CYCLE_STATUS_LABEL, fmtDate, RATING_LABEL, RATINGS, ratingLabel, REVIEW_STAGE_LABEL, REVIEW_STAGES, type ReviewStage } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { PersonCell } from "@/components/ui/avatar";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { STAGE_TONE } from "@/pages/ess/Reviews";
import { CYCLE_TONE, CycleDialog, type CycleRow } from "./Cycles";

interface Row {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  manager: string | null;
  managerId: string | null;
  stage: ReviewStage;
  selfScore: number | null;
  managerScore: number | null;
  finalRating: number | null;
  mine: boolean;
}
interface Data {
  cycle: CycleRow;
  canManage: boolean;
  rows: Row[];
  eligible?: { employeeId: string; name: string; code: string; department: string | null }[];
  noManager?: number;
  distribution: Record<number, number>;
}

/** How many people sit in each rating band. */
function Distribution({ d }: { d: Record<number, number> }) {
  const total = Object.values(d).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(d));
  return (
    <Card className="!gap-2.5">
      <CardHeader title="Rating spread" sub={total ? `${total} rated. Uses the final rating where HR has set one, else the manager's score.` : "Appears as managers finish their reviews."} />
      {RATINGS.slice().reverse().map((n) => (
        <div key={n} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate">{n} · {RATING_LABEL[n]}</span>
          <div className="h-3 overflow-hidden rounded-full bg-[var(--tint-1)]" role="img" aria-label={`${d[n] ?? 0} people`}>
            <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${((d[n] ?? 0) / max) * 100}%` }} />
          </div>
          <span className="num w-16 text-right">{d[n] ?? 0}{total ? <span className="text-muted"> · {Math.round(((d[n] ?? 0) / total) * 100)}%</span> : null}</span>
        </div>
      ))}
    </Card>
  );
}

export default function CycleDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const key = ["performance", "cycle", id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Data>(`/admin/performance/cycles/${id}`) });
  const [editing, setEditing] = useState(false);
  const [calibrating, setCalibrating] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<"launch" | "share" | "close" | "delete" | null>(null);
  const [find, setFind] = useState("");
  const [stage, setStage] = useState<ReviewStage | "">("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["performance"] });
  const act = useMutation({
    mutationFn: async (a: { path: string; body?: unknown; method?: "DELETE" }) => (a.method ? api.del(a.path) : api.post<Record<string, number>>(a.path, a.body ?? {})),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = (path: string, ok: (r: Record<string, number>) => string, body?: unknown) =>
    act.mutate({ path, body }, { onSuccess: (r) => (toast.success(ok((r ?? {}) as Record<string, number>)), refresh(), setConfirm(null)) });

  const d = q.data;
  const hr = !!d?.canManage;
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => <PersonCell employeeId={r.employeeId} name={r.name} sub={[r.code, r.department].filter(Boolean).join(" · ")} /> },
      { id: "manager", header: "Reviewer", accessorFn: (r) => r.manager ?? "", cell: ({ getValue }) => getValue<string>() || <Tag tone="warn">No reviewer</Tag> },
      { id: "stage", header: "Stage", accessorKey: "stage", cell: ({ row: { original: r } }) => <Tag tone={STAGE_TONE[r.stage]}>{REVIEW_STAGE_LABEL[r.stage]}</Tag> },
      { id: "self", header: "Self", accessorKey: "selfScore", cell: ({ getValue }) => getValue<number | null>() ?? "—" },
      { id: "managerScore", header: "Manager", accessorKey: "managerScore", cell: ({ getValue }) => getValue<number | null>() ?? "—" },
      ...(hr ? [{ id: "final", header: "Final", accessorKey: "finalRating", cell: ({ row: { original: r } }: { row: { original: Row } }) => (r.finalRating != null ? <div><b>{r.finalRating}</b><div className="text-muted text-[12px]">{ratingLabel(r.finalRating)}</div></div> : "—") } as ColumnDef<Row>] : []),
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row: { original: r } }) => {
          const items = [
            ...(!r.mine ? [{ label: r.stage === "manager" ? "Review" : "Open", onSelect: () => nav(`/performance/reviews/${r.id}`) }] : []),
            ...(hr && d?.cycle.status === "active"
              ? [
                  ...(r.stage === "self" ? [{ label: "Skip self review", onSelect: () => run(`/admin/performance/reviews/${r.id}/skip-self`, () => `${r.name}'s review moved to their manager`) }] : []),
                  ...(r.stage === "calibration" && !r.mine ? [{ label: "Set final rating", onSelect: () => setCalibrating(r) }, { label: "Send back to manager", onSelect: () => run(`/admin/performance/reviews/${r.id}/reopen`, () => "Sent back to the manager") }] : []),
                  ...(r.stage === "calibration" ? [{ label: "Share with employee", onSelect: () => run(`/admin/performance/cycles/${id}/share`, () => `Shared with ${r.name}`, { reviewIds: [r.id] }) }] : []),
                ]
              : []),
          ];
          return items.length ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Menu trigger={<Button size="sm">{r.stage === "manager" && !hr ? "Review" : "Manage"}</Button>} items={items} />
            </div>
          ) : null;
        },
      },
    ],
    [hr, d?.cycle.status, id, nav], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (q.isLoading) return <Loading />;
  if (q.error || !d) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const c = d.cycle;
  const count = (s: ReviewStage) => d.rows.filter((r) => r.stage === s).length;
  const ready = count("calibration");

  return (
    <>
      <Link to="/performance" className="inline-flex items-center gap-1 self-start text-[13px] no-underline">
        <ChevronLeft size={15} /> All review cycles
      </Link>
      <PageHeader
        title={c.name}
        sub={`${fmtDate(c.periodStart)} to ${fmtDate(c.periodEnd)} · self reviews due ${fmtDate(c.selfDue)} · manager reviews due ${fmtDate(c.managerDue)}`}
        actions={
          <>
            <Tag tone={CYCLE_TONE[c.status]}>{CYCLE_STATUS_LABEL[c.status]}</Tag>
            {hr && c.status !== "closed" ? <Button onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button> : null}
            {hr && c.status === "draft" ? (
              <>
                <Button variant="danger" onClick={() => setConfirm("delete")}>Delete</Button>
                <Button variant="primary" onClick={() => setConfirm("launch")} disabled={!d.eligible?.length}>Start cycle</Button>
              </>
            ) : null}
            {hr && c.status !== "draft" ? <Button onClick={() => download(`/admin/performance/cycles/${id}/export.xlsx`, "reviews.xlsx").catch((e) => toast.error(errorMessage(e)))}><Download size={15} /> Export</Button> : null}
            {hr && c.status === "active" ? (
              <>
                <Button loading={act.isPending && act.variables?.path.endsWith("/remind")} onClick={() => run(`/admin/performance/cycles/${id}/remind`, (r) => `Reminders sent: ${r.self} self reviews, ${r.managers} managers`)}>Send reminders</Button>
                <Button onClick={() => setConfirm("close")}>Close cycle</Button>
                <Button variant="primary" disabled={!ready} onClick={() => setConfirm("share")}>Share {ready || ""} with employees</Button>
              </>
            ) : null}
          </>
        }
      />

      {c.status === "draft" ? (
        <>
          <Notice tone="sel">
            {d.eligible?.length ?? 0} people will take part{c.competencies.length ? `, rated on their goals and ${c.competencies.length} competencies (${c.competencies.join(", ")})` : ", rated on their goals"}. Starting the cycle emails everyone to set goals and do their self review.
          </Notice>
          {d.noManager ? <Notice tone="warn">{d.noManager} of them have no manager on record. Set one in their profile, or HR can review them.</Notice> : null}
          <TableCard>
            <CardHeader className="py-2" title="Who takes part" />
            <DataTable
              data={d.eligible ?? []}
              columns={[{ id: "employee", header: "Employee", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => <PersonCell employeeId={r.employeeId} name={r.name} sub={r.code} /> }, { id: "department", header: "Department", accessorFn: (r) => r.department ?? "—" }]}
              getRowId={(r) => r.employeeId}
              storageKey="cycle-eligible"
              empty="Nobody matches. Edit who takes part."
            />
          </TableCard>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {REVIEW_STAGES.map((s) => <StatCard key={s} label={REVIEW_STAGE_LABEL[s]} value={count(s)} />)}
          </div>
          {hr ? <Distribution d={d.distribution} /> : null}
          <TableCard>
            <CardHeader className="py-2" title={hr ? "Everyone in this cycle" : "Your team"} sub={hr ? "Set the final rating where it should differ from the manager's, then share." : "Review each person once their self review is in."} />
            <DataTable
              data={d.rows.filter((r) => (!stage || r.stage === stage) && (!find.trim() || `${r.name} ${r.code} ${r.manager ?? ""}`.toLowerCase().includes(find.trim().toLowerCase())))}
              toolbar={
                <div className="flex flex-wrap gap-2">
                  <Input aria-label="Find a person" placeholder="Find a person or reviewer" value={find} onChange={(e) => setFind(e.target.value)} className="!w-[220px]" />
                  <Select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value as ReviewStage | "")} className="!w-[170px]">
                    <option value="">All stages</option>
                    {REVIEW_STAGES.map((s) => <option key={s} value={s}>{REVIEW_STAGE_LABEL[s]}</option>)}
                  </Select>
                </div>
              }
              columns={columns} getRowId={(r) => r.id} onRowClick={(r) => (r.mine ? undefined : nav(`/performance/reviews/${r.id}`))} storageKey="cycle-reviews" empty="Nobody to show." />
          </TableCard>
        </>
      )}

      {editing ? <CycleDialog cycle={c} onClose={() => setEditing(false)} /> : null}
      {calibrating ? <CalibrateDialog row={calibrating} onClose={() => setCalibrating(null)} onDone={refresh} /> : null}
      {confirm ? (
        <Dialog
          open
          onOpenChange={(v) => !v && setConfirm(null)}
          title={{ launch: `Start ${c.name}?`, share: `Share ${ready} review${ready === 1 ? "" : "s"}?`, close: `Close ${c.name}?`, delete: "Delete this draft?" }[confirm]}
          description={
            {
              launch: `${d.eligible?.length ?? 0} people get an email to set their goals and do their self review by ${fmtDate(c.selfDue)}.`,
              share: "Each person sees their manager's review and final rating, and gets an email. Reviews without a final rating use the manager's score.",
              close: "Nothing more can change. Reviews that aren't finished stay as they are.",
              delete: "The draft is removed. Nobody has been told about it.",
            }[confirm]
          }
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant={confirm === "delete" ? "danger" : "primary"}
                loading={act.isPending}
                onClick={() =>
                  confirm === "launch"
                    ? run(`/admin/performance/cycles/${id}/launch`, (r) => `Started for ${r.reviews} people`)
                    : confirm === "share"
                      ? run(`/admin/performance/cycles/${id}/share`, (r) => `${r.shared} reviews shared`)
                      : confirm === "close"
                        ? run(`/admin/performance/cycles/${id}/close`, () => "Cycle closed")
                        : act.mutate({ path: `/admin/performance/cycles/${id}`, method: "DELETE" }, { onSuccess: () => (toast.success("Draft deleted"), refresh(), nav("/performance")) })
                }
              >
                {{ launch: "Start cycle", share: "Share", close: "Close cycle", delete: "Delete" }[confirm]}
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}

export function CalibrateDialog({ row, onClose, onDone }: { row: { id: string; name: string; managerScore: number | null; finalRating: number | null }; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(String(row.finalRating ?? row.managerScore ?? 3));
  const [note, setNote] = useState("");
  const n = Number(rating);
  const differs = row.managerScore != null && Math.abs(n - row.managerScore) >= 0.05;
  const save = useMutation({
    mutationFn: () => api.post(`/admin/performance/reviews/${row.id}/calibrate`, { finalRating: n, note }),
    onSuccess: () => (toast.success("Final rating saved"), onDone(), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = n >= 1 && n <= 5 && Math.round(n * 10) === n * 10;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Final rating for ${row.name}`}
      description={row.managerScore != null ? `The manager's score is ${row.managerScore} (${ratingLabel(row.managerScore)}).` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || (differs && note.trim().length < 3)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Final rating (1 to 5)" hint={valid ? ratingLabel(n) : "Use one decimal at most, e.g. 3.5"}>
          <Input type="number" min={1} max={5} step={0.1} value={rating} onChange={(e) => setRating(e.target.value)} />
        </Field>
        <Field label={differs ? "Why it differs from the manager's score" : "Note (optional)"} hint="Only HR and the reviewer see this">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
