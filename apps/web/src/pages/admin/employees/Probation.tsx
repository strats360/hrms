import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { addMonthsToDate, fmtDate, PROBATION_RECOMMENDATION_LABEL, todayIST, type ProbationRecommendation, type ProbationSettings } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { PersonCell } from "@/components/ui/avatar";
import { ErrorState } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { GenerateLetterDialog } from "@/components/letters/GenerateLetterDialog";

interface Row {
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  designation: string | null;
  manager: string | null;
  managerId: string | null;
  dateOfJoining: string;
  endDate: string;
  daysLeft: number;
  due: boolean;
  extensions: number;
  review: { recommendation: ProbationRecommendation; note: string; by: string; at: string } | null;
}
type Action = { kind: "review" | "confirm" | "extend"; row: Row };
const REC_TONE: Record<ProbationRecommendation, Tone> = { confirm: "ok", extend: "warn", not_confirm: "bad" };

function when(r: Row) {
  if (r.daysLeft < 0) return <Tag tone="bad">{-r.daysLeft} day{r.daysLeft === -1 ? "" : "s"} overdue</Tag>;
  if (r.daysLeft === 0) return <Tag tone="warn">Ends today</Tag>;
  return r.due ? <Tag tone="warn">In {r.daysLeft} day{r.daysLeft === 1 ? "" : "s"}</Tag> : <span className="text-muted text-[12.5px]">In {r.daysLeft} days</span>;
}

export default function Probation() {
  const { tenant } = useSession();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["probation"], queryFn: () => api.get<{ rows: Row[]; settings: ProbationSettings; canDecide: boolean }>("/admin/probation") });
  const [action, setAction] = useState<Action | null>(null);
  const [letter, setLetter] = useState<{ id: string; fullName: string; template: string } | null>(null);
  const canDecide = !!q.data?.canDecide;
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => <PersonCell employeeId={r.employeeId} name={r.name} sub={[r.code, r.designation].filter(Boolean).join(" · ")} /> },
      { id: "manager", header: "Manager", accessorFn: (r) => r.manager ?? "", cell: ({ getValue }) => getValue<string>() || "—" },
      { id: "joined", header: "Joined", accessorKey: "dateOfJoining", cell: ({ getValue }) => fmtDate(getValue<string>()) },
      { id: "end", header: "Probation ends", accessorKey: "endDate", cell: ({ row: { original: r } }) => <div>{fmtDate(r.endDate)}<div>{when(r)}{r.extensions ? <span className="text-muted ml-1.5 text-[12px]">extended {r.extensions === 1 ? "once" : `${r.extensions} times`}</span> : null}</div></div> },
      { id: "review", header: "Manager's view", enableSorting: false, cell: ({ row: { original: r } }) => (r.review ? <div className="max-w-[260px] whitespace-normal"><Tag tone={REC_TONE[r.review.recommendation]}>{PROBATION_RECOMMENDATION_LABEL[r.review.recommendation]}</Tag><div className="text-muted line-clamp-2 text-[12px]">{r.review.note} · {r.review.by}</div></div> : <span className="text-muted text-[12.5px]">Not reviewed</span>) },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row: { original: r } }) => {
          const mine = r.managerId === tenant?.employeeId;
          const items = [
            ...(mine || canDecide ? [{ label: r.review ? "Update review" : "Review", onSelect: () => setAction({ kind: "review", row: r }) }] : []),
            ...(canDecide
              ? [
                  { label: "Confirm employment", onSelect: () => setAction({ kind: "confirm", row: r }) },
                  { label: "Extend probation", onSelect: () => setAction({ kind: "extend", row: r }) },
                  { label: "Not confirming: start exit", onSelect: () => nav(`/employees/exits?employee=${r.employeeId}`), danger: true },
                ]
              : []),
          ];
          return items.length ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Menu trigger={<Button size="sm">{r.due && canDecide ? "Decide" : "Manage"}</Button>} items={items} />
            </div>
          ) : null;
        },
      },
    ],
    [canDecide, tenant?.employeeId, nav],
  );
  return (
    <div className="flex flex-col gap-4">
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <CardHeader
          className="py-2"
          title="On probation"
          sub={q.data ? `The manager and HR get an email ${q.data.settings.reminderDays} days before probation ends. Managers give their view; HR confirms or extends.` : undefined}
          actions={q.data && canDecide ? <SettingsButton settings={q.data.settings} /> : null}
        />
        <DataTable data={q.data?.rows ?? []} columns={columns} getRowId={(r) => r.employeeId} loading={q.isFetching} onRowClick={(r) => nav(`/employees/${r.employeeId}`)} storageKey="probation" empty="Nobody is on probation right now." />
      </TableCard>
      {action ? <ActionDialog action={action} onClose={() => setAction(null)} onDone={(template) => (template ? setLetter({ id: action.row.employeeId, fullName: action.row.name, template }) : null, setAction(null))} /> : null}
      {letter ? <GenerateLetterDialog employee={letter} initialTemplate={letter.template} onClose={() => setLetter(null)} /> : null}
    </div>
  );
}

function ActionDialog({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: (letterTemplate?: string) => void }) {
  const qc = useQueryClient();
  const r = action.row;
  const [f, setF] = useState({ recommendation: (r.review?.recommendation ?? "confirm") as ProbationRecommendation, note: "", date: r.endDate < todayIST() ? todayIST() : r.endDate, until: addMonthsToDate(r.endDate, 1) });
  const [letter, setLetter] = useState(true);
  const save = useMutation({
    mutationFn: () =>
      action.kind === "review"
        ? api.post(`/admin/probation/${r.employeeId}/review`, { recommendation: f.recommendation, note: f.note })
        : action.kind === "confirm"
          ? api.post(`/admin/probation/${r.employeeId}/confirm`, { date: f.date, note: f.note || null })
          : api.post(`/admin/probation/${r.employeeId}/extend`, { until: f.until, reason: f.note }),
    onSuccess: () => {
      toast.success(action.kind === "review" ? "Review saved" : action.kind === "confirm" ? `${r.name} is confirmed` : `Probation extended to ${fmtDate(f.until)}`);
      qc.invalidateQueries({ queryKey: ["probation"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onDone(action.kind !== "review" && letter ? (action.kind === "confirm" ? "builtin:confirmation" : "builtin:probation_extension") : undefined);
    },
  });
  const title = action.kind === "review" ? `Review ${r.name}'s probation` : action.kind === "confirm" ? `Confirm ${r.name}?` : `Extend ${r.name}'s probation`;
  const needsNote = action.kind !== "confirm";
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={title}
      description={`Joined ${fmtDate(r.dateOfJoining)} · probation ends ${fmtDate(r.endDate)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={needsNote && f.note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>
            {action.kind === "review" ? "Save review" : action.kind === "confirm" ? "Confirm" : "Extend"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {r.review && action.kind !== "review" ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--tint-1)] p-3 text-[13px]">
            <b>{r.review.by}</b> recommends <b>{PROBATION_RECOMMENDATION_LABEL[r.review.recommendation].toLowerCase()}</b>: {r.review.note}
          </div>
        ) : null}
        {action.kind === "review" ? (
          <Field label="Recommendation">
            <Select value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value as ProbationRecommendation })}>
              {Object.entries(PROBATION_RECOMMENDATION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        {action.kind === "confirm" ? (
          <Field label="Confirmed from"><Input type="date" min={r.dateOfJoining} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        ) : null}
        {action.kind === "extend" ? (
          <Field label="Extend until"><Input type="date" min={r.endDate} value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field>
        ) : null}
        <Field label={action.kind === "review" ? "How have they done?" : action.kind === "confirm" ? "Note (optional)" : "Reason (the employee sees this)"}>
          <Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        {action.kind !== "review" ? (
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={letter} onChange={(e) => setLetter(e.target.checked)} />
            Then prepare the {action.kind === "confirm" ? "confirmation" : "extension"} letter
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}

function SettingsButton({ settings }: { settings: ProbationSettings }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const save = useMutation({ mutationFn: () => api.put("/admin/probation/settings", s), onSuccess: () => (toast.success("Probation settings saved"), qc.invalidateQueries({ queryKey: ["probation"] }), setOpen(false)) });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Settings</Button>
      {open ? (
        <Dialog
          open
          onOpenChange={setOpen}
          title="Probation settings"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Remind this many days before it ends"><Input type="number" min={1} max={60} value={s.reminderDays} onChange={(e) => setS({ ...s, reminderDays: Number(e.target.value) })} /></Field>
            <Field label="Probation length if not set (months)" hint="Each employee's own probation months take priority"><Input type="number" min={1} max={24} value={s.defaultMonths} onChange={(e) => setS({ ...s, defaultMonths: Number(e.target.value) })} /></Field>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
