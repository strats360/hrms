import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { fmtDate, PRIVACY_STATUS_LABEL, type PrivacyRequestStatus, type PrivacySettings } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { PersonCell } from "@/components/ui/avatar";
import { ErrorState, Notice } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { WhatErasureMeans } from "@/components/account/MyData";

interface Row {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  status: PrivacyRequestStatus;
  source: "employee" | "hr";
  reason: string | null;
  dueDate: string | null;
  overdue: boolean;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
  summary: Record<string, number> | null;
  blocker: string | null;
}
interface Data {
  rows: Row[];
  settings: PrivacySettings;
  erased: string[];
  kept: string[];
}
const TONE: Record<PrivacyRequestStatus, Tone> = { pending: "warn", completed: "ok", rejected: "bad", cancelled: "neutral" };
const SUMMARY_LABEL: Record<string, string> = { documents: "documents", photo: "photo", selfies: "selfies", punchLocations: "punch locations", onboarding: "onboarding forms", signIns: "sign-in" };

export const summaryText = (s: Record<string, number> | null) =>
  s ? Object.entries(s).filter(([, n]) => n > 0).map(([k, n]) => (k === "photo" || k === "signIns" ? SUMMARY_LABEL[k] : `${n} ${SUMMARY_LABEL[k] ?? k}`)).join(", ") || "Profile details only" : "";

export async function downloadEmployeeData(employeeId: string) {
  try {
    await download(`/admin/privacy/employees/${employeeId}/export`, "employee-data.zip");
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export default function DataRequests() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["privacy"], queryFn: () => api.get<Data>("/admin/privacy") });
  const [action, setAction] = useState<{ kind: "erase" | "reject"; row: Row } | null>(null);
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => <PersonCell employeeId={r.employeeId} name={r.name} sub={r.code} /> },
      { id: "asked", header: "Asked", accessorKey: "createdAt", cell: ({ row: { original: r } }) => <div>{fmtDate(r.createdAt.slice(0, 10))}<div className="text-muted text-[12px]">{r.source === "hr" ? "By HR after exit" : "By the employee"}</div></div> },
      { id: "reason", header: "Reason", enableSorting: false, cell: ({ row: { original: r } }) => <div className="text-muted line-clamp-2 max-w-[240px] whitespace-normal text-[12.5px]">{r.reason || "—"}</div> },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ row: { original: r } }) => (
          <div className="max-w-[300px] whitespace-normal">
            <Tag tone={r.overdue ? "bad" : TONE[r.status]}>{r.overdue ? "Overdue" : PRIVACY_STATUS_LABEL[r.status]}</Tag>
            <div className="text-muted text-[12px]">
              {r.status === "pending"
                ? [r.dueDate ? `Answer by ${fmtDate(r.dueDate)}` : null, r.blocker].filter(Boolean).join(" · ")
                : [r.decidedByName, r.decidedAt ? fmtDate(r.decidedAt.slice(0, 10)) : null, r.status === "completed" ? summaryText(r.summary) : r.decisionNote].filter(Boolean).join(" · ")}
            </div>
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row: { original: r } }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Menu
              trigger={<Button size="sm">{r.status === "pending" ? "Answer" : "More"}</Button>}
              items={[
                { label: "Download their data", onSelect: () => downloadEmployeeData(r.employeeId) },
                ...(r.status === "pending"
                  ? [
                      { label: "Erase personal data", onSelect: () => setAction({ kind: "erase", row: r }), danger: true },
                      { label: "Decline with a reason", onSelect: () => setAction({ kind: "reject", row: r }) },
                    ]
                  : []),
              ]}
            />
          </div>
        ),
      },
    ],
    [],
  );
  const pending = q.data?.rows.filter((r) => r.status === "pending").length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      {q.data && !q.data.settings.officerEmail ? <Notice tone="warn">Add the contact for data questions (your grievance officer) in Settings. Employees see it on their account page.</Notice> : null}
      <TableCard>
        <CardHeader
          className="py-2"
          title="Data requests"
          sub={q.data ? `${pending ? `${pending} waiting. ` : ""}Employees can download their data any time and ask for it to be erased. Answer within ${q.data.settings.responseDays} days.` : undefined}
          actions={q.data ? <SettingsButton settings={q.data.settings} /> : null}
        />
        <DataTable data={q.data?.rows ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => nav(`/employees/${r.employeeId}`)} storageKey="privacy" empty="No data requests yet." />
      </TableCard>
      {action && q.data ? <DecideDialog action={action} data={q.data} onClose={() => setAction(null)} /> : null}
    </div>
  );
}

/** Erase (with or without a request) or decline. Used here and on the employee profile. */
export function DecideDialog({ action, data, onClose }: { action: { kind: "erase" | "reject"; row: { id?: string; employeeId: string; name: string; blocker: string | null } }; data: { erased: string[]; kept: string[] }; onClose: () => void }) {
  const qc = useQueryClient();
  const r = action.row;
  const [note, setNote] = useState("");
  const [sure, setSure] = useState("");
  const erase = action.kind === "erase";
  const save = useMutation({
    mutationFn: () =>
      erase
        ? api.post(r.id ? `/admin/privacy/requests/${r.id}/erase` : `/admin/privacy/employees/${r.employeeId}/erase`, { note })
        : api.post(`/admin/privacy/requests/${r.id}/reject`, { note }),
    onSuccess: () => {
      toast.success(erase ? `${r.name}'s personal data is erased` : "Request declined. They've been told why.");
      qc.invalidateQueries({ queryKey: ["privacy"] });
      qc.invalidateQueries({ queryKey: ["employee", r.employeeId] });
      qc.invalidateQueries({ queryKey: ["privacy-employee", r.employeeId] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ready = erase ? !r.blocker && sure.trim().toLowerCase() === "erase" : note.trim().length >= 3;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={erase ? `Erase ${r.name}'s personal data?` : `Decline ${r.name}'s request`}
      width={erase ? 620 : 520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={erase ? "danger" : "primary"} disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>
            {erase ? "Erase for good" : "Decline"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {erase ? (
          <>
            {r.blocker ? <Notice tone="bad">Can't erase yet: {r.blocker}.</Notice> : <Notice tone="warn">This can't be undone. Download their data first if you need a copy.</Notice>}
            <WhatErasureMeans erased={data.erased} kept={data.kept} />
            <Field label="Note for the employee (optional)" hint="Sent to their personal email with the confirmation">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {!r.blocker ? (
              <Field label='Type "erase" to confirm'>
                <Input value={sure} onChange={(e) => setSure(e.target.value)} autoComplete="off" />
              </Field>
            ) : null}
          </>
        ) : (
          <Field label="Reason (the employee sees this)">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={r.blocker ? `${r.blocker}.` : ""} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function SettingsButton({ settings }: { settings: PrivacySettings }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const save = useMutation({
    mutationFn: () => api.put("/admin/privacy/settings", { ...s, officerName: s.officerName?.trim() || null, officerEmail: s.officerEmail?.trim() || null }),
    onSuccess: () => (toast.success("Saved"), qc.invalidateQueries({ queryKey: ["privacy"] }), setOpen(false)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Settings</Button>
      {open ? (
        <Dialog
          open
          onOpenChange={setOpen}
          title="Data request settings"
          description="Under the DPDP Act, employees need a contact for questions and complaints about their data."
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Grievance officer"><Input value={s.officerName ?? ""} onChange={(e) => setS({ ...s, officerName: e.target.value })} placeholder="Name" /></Field>
            <Field label="Their email"><Input type="email" value={s.officerEmail ?? ""} onChange={(e) => setS({ ...s, officerEmail: e.target.value })} placeholder="privacy@company.com" /></Field>
            <Field label="Answer requests within (days)"><Input type="number" min={1} max={90} value={s.responseDays} onChange={(e) => setS({ ...s, responseDays: Number(e.target.value) })} /></Field>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
