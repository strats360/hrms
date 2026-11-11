import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Paperclip, Pin, Plus } from "lucide-react";
import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_CATEGORY_LABEL, fmtDate, todayIST, type AnnouncementCategory } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { ErrorState, Notice, PageHeader } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { useLookups } from "@/components/recruitment/shared";
import { Body } from "@/components/announcements/Body";

interface Row {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  audience: { departmentIds: string[]; branchIds: string[] };
  pinned: boolean;
  requireAck: boolean;
  emailEveryone: boolean;
  status: "draft" | "published" | "archived";
  state: "draft" | "scheduled" | "live" | "expired" | "archived";
  publishAt: string | null;
  expiresAt: string | null;
  emailedAt: string | null;
  attachmentName: string | null;
  hasAttachment: boolean;
  authorName: string | null;
  audienceSize: number;
  read: number;
  acknowledged: number;
}
const STATE: Record<Row["state"], [string, Tone]> = { draft: ["Draft", "neutral"], scheduled: ["Scheduled", "accent"], live: ["Live", "ok"], expired: ["Ended", "outline"], archived: ["Taken down", "outline"] };
export const CATEGORY_TONE: Record<AnnouncementCategory, Tone> = { general: "neutral", policy: "accent", holiday: "ok", event: "accent", celebration: "ok", urgent: "bad" };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Announcements() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["announcements", "admin"], queryFn: () => api.get<Row[]>("/admin/announcements") });
  const L = useLookups();
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [readers, setReaders] = useState<Row | null>(null);
  const takeDown = useMutation({
    mutationFn: (id: string) => api.post(`/admin/announcements/${id}/archive`),
    onSuccess: () => (toast.success("Taken down"), qc.invalidateQueries({ queryKey: ["announcements"] })),
  });
  const names = useMemo(() => new Map([...(L.data?.departments ?? []), ...(L.data?.branches ?? [])].map((x) => [x.id, x.name])), [L.data]);
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "title", header: "Announcement", accessorKey: "title", cell: ({ row: { original: a } }) => <div className="max-w-[420px] whitespace-normal"><div className="flex items-center gap-1.5 font-medium">{a.pinned ? <Pin size={13} aria-label="Pinned" /> : null}{a.title}{a.hasAttachment ? <Paperclip size={13} className="text-muted" aria-label="Has attachment" /> : null}</div><div className="text-muted line-clamp-1 text-[12px]">{a.body}</div></div> },
      { id: "category", header: "Type", accessorKey: "category", cell: ({ getValue }) => <Tag tone={CATEGORY_TONE[getValue<AnnouncementCategory>()]}>{ANNOUNCEMENT_CATEGORY_LABEL[getValue<AnnouncementCategory>()]}</Tag> },
      { id: "audience", header: "For", enableSorting: false, cell: ({ row: { original: a } }) => { const ids = [...a.audience.departmentIds, ...a.audience.branchIds]; return <div className="text-[12.5px]">{ids.length ? ids.map((i) => names.get(i) ?? "").join(", ") : "Everyone"}<div className="text-muted">{a.audienceSize} people</div></div>; } },
      { id: "state", header: "Status", accessorKey: "state", cell: ({ row: { original: a } }) => <div><Tag tone={STATE[a.state][1]}>{STATE[a.state][0]}</Tag><div className="text-muted text-[12px]">{a.publishAt ? when(a.publishAt) : ""}{a.expiresAt ? ` · until ${fmtDate(a.expiresAt)}` : ""}</div></div> },
      { id: "reads", header: "Read", enableSorting: false, cell: ({ row: { original: a } }) => (a.state === "live" || a.state === "expired" ? <button type="button" className="text-left text-[12.5px]" onClick={(e) => (e.stopPropagation(), setReaders(a))}><span className="num">{a.read} of {a.audienceSize}</span>{a.requireAck ? <div className="text-muted">{a.acknowledged} confirmed</div> : null}</button> : "—") },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row: { original: a } }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Menu trigger={<Button size="sm">Manage</Button>} items={[{ label: "Edit", onSelect: () => setEdit(a) }, ...(a.state === "live" || a.state === "expired" ? [{ label: "Who has read it", onSelect: () => setReaders(a) }] : []), ...(a.status !== "archived" && a.status !== "draft" ? [{ label: "Take down", onSelect: () => takeDown.mutate(a.id), danger: true }] : [])]} />
          </div>
        ),
      },
    ],
    [names, takeDown],
  );
  return (
    <>
      <PageHeader title="Announcements" sub="News, policies, holidays and events for everyone or chosen teams" actions={<Button variant="primary" onClick={() => setEdit("new")}><Plus size={16} /> New announcement</Button>} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <CardHeader className="py-2" title="Posts" sub="Employees see live posts on their self-service Home. Pinned posts stay at the top." />
        <DataTable data={q.data ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => setEdit(r)} storageKey="announcements" empty="Nothing posted yet." />
      </TableCard>
      {edit ? <EditDialog row={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
      {readers ? <ReadersDialog row={readers} onClose={() => setReaders(null)} /> : null}
    </>
  );
}

const localInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16) : "");

function EditDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const L = useLookups();
  const scheduled = row?.state === "scheduled";
  const [f, setF] = useState({
    title: row?.title ?? "",
    body: row?.body ?? "",
    category: (row?.category ?? "general") as AnnouncementCategory,
    departmentIds: row?.audience.departmentIds ?? [],
    branchIds: row?.audience.branchIds ?? [],
    pinned: row?.pinned ?? false,
    requireAck: row?.requireAck ?? false,
    emailEveryone: row?.emailEveryone ?? true,
    when: scheduled ? "later" : "now",
    publishAt: scheduled ? localInput(row!.publishAt) : "",
    expiresAt: row?.expiresAt ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(false);
  const save = useMutation({
    mutationFn: async (draft: boolean) => {
      const body = { title: f.title, body: f.body, category: f.category, departmentIds: f.departmentIds, branchIds: f.branchIds, pinned: f.pinned, requireAck: f.requireAck, emailEveryone: f.emailEveryone, publishAt: f.when === "later" && f.publishAt ? `${f.publishAt}:00+05:30` : null, expiresAt: f.expiresAt || null, draft };
      const r = row ? await api.put<{ id: string; emailed: number; state: string }>(`/admin/announcements/${row.id}`, body) : await api.post<{ id: string; emailed: number; state: string }>("/admin/announcements", body);
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        await api.post(`/admin/announcements/${r.id}/attachment`, fd);
      }
      return r;
    },
    onSuccess: (r) => {
      toast.success(r.state === "draft" ? "Draft saved" : r.state === "scheduled" ? "Scheduled" : r.emailed ? `Posted and emailed to ${r.emailed} people` : "Posted");
      qc.invalidateQueries({ queryKey: ["announcements"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = (k: "departmentIds" | "branchIds", id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const live = row && (row.state === "live" || row.state === "expired");
  const ready = f.title.trim().length >= 3 && f.body.trim().length >= 3 && (f.when === "now" || !!f.publishAt);
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={row ? "Edit announcement" : "New announcement"}
      width={760}
      footer={
        <>
          <Button onClick={() => setPreview(!preview)}>{preview ? "Back to editing" : "Preview"}</Button>
          <div className="flex-1" />
          {!live ? <Button loading={save.isPending && save.variables === true} disabled={!ready} onClick={() => save.mutate(true)}>Save draft</Button> : null}
          <Button variant="primary" loading={save.isPending && save.variables === false} disabled={!ready} onClick={() => save.mutate(false)}>{live ? "Save" : f.when === "later" ? "Schedule" : "Post now"}</Button>
        </>
      }
    >
      {preview ? (
        <div className="flex flex-col gap-2">
          <Tag tone={CATEGORY_TONE[f.category]}>{ANNOUNCEMENT_CATEGORY_LABEL[f.category]}</Tag>
          <h2 className="!m-0 text-[22px]">{f.title || "Untitled"}</h2>
          <Body text={f.body} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" span><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={150} /></Field>
          <Field label="Type"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as AnnouncementCategory })}>{ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{ANNOUNCEMENT_CATEGORY_LABEL[c]}</option>)}</Select></Field>
          <Field label="Show until (optional)" hint="It drops off Home after this date"><Input type="date" min={todayIST()} value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
          <Field label="Message" span hint="Plain text. Leave a blank line between paragraphs. Links become clickable."><Textarea rows={9} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Field label="Who sees it" span hint="Everyone, unless you pick departments or branches">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">{L.data?.departments.map((d) => <Checkbox key={d.id} checked={f.departmentIds.includes(d.id)} onChange={() => toggle("departmentIds", d.id)} label={d.name} />)}</div>
              {L.data && L.data.branches.length > 1 ? <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--color-divider)] pt-2">{L.data.branches.map((b) => <Checkbox key={b.id} checked={f.branchIds.includes(b.id)} onChange={() => toggle("branchIds", b.id)} label={b.name} />)}</div> : null}
            </div>
          </Field>
          {!live ? (
            <Field label="When" span>
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox checked={f.when === "later"} onChange={(v) => setF({ ...f, when: v ? "later" : "now" })} label="Schedule for later" />
                {f.when === "later" ? <Input type="datetime-local" aria-label="Publish at (IST)" value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} className="!w-[230px]" /> : null}
              </div>
            </Field>
          ) : null}
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Checkbox checked={f.pinned} onChange={(v) => setF({ ...f, pinned: v })} label="Pin to the top" />
            <Checkbox checked={f.requireAck} onChange={(v) => setF({ ...f, requireAck: v })} label="Ask people to confirm they've read it (for policies)" />
            {!row?.emailedAt ? <Checkbox checked={f.emailEveryone} onChange={(v) => setF({ ...f, emailEveryone: v })} label={f.category === "urgent" ? "Email everyone (urgent posts reach people even if they've turned announcement emails off)" : "Email everyone it's for"} /> : <div className="text-muted text-[12.5px]">Emailed {when(row.emailedAt)}. Edits won't email again.</div>}
          </div>
          <Field label="Attachment (optional)" span hint={row?.attachmentName ? `Now: ${row.attachmentName}. Choose a file to replace it.` : "A PDF or image, up to 10 MB"}>
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
          </Field>
          {f.category === "urgent" ? <div className="sm:col-span-2"><Notice tone="warn">Urgent posts are for things people must know now, like an office closure.</Notice></div> : null}
        </div>
      )}
    </Dialog>
  );
}

function ReadersDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const q = useQuery({ queryKey: ["announcements", "readers", row.id], queryFn: () => api.get<{ employeeId: string; name: string; code: string; readAt: string | null; acknowledgedAt: string | null }[]>(`/admin/announcements/${row.id}/readers`) });
  const [find, setFind] = useState("");
  const list = (q.data ?? []).filter((r) => !find.trim() || `${r.name} ${r.code}`.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={row.title} description={`${row.read} of ${row.audienceSize} have read it${row.requireAck ? `, ${row.acknowledged} confirmed` : ""}. Not read yet are listed first.`} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-2">
        <Input aria-label="Find a person" placeholder="Find a person" value={find} onChange={(e) => setFind(e.target.value)} />
        <div className="max-h-[50vh] overflow-y-auto">
          {list.map((r) => (
            <div key={r.employeeId} className="flex items-center justify-between gap-2 border-b border-[var(--color-divider)] py-2 text-[13px] last:border-b-0">
              <span>{r.name} <span className="text-muted">({r.code})</span></span>
              {r.acknowledgedAt ? <Tag tone="ok">Confirmed</Tag> : r.readAt ? <Tag tone="accent">Read</Tag> : <Tag tone="outline">Not yet</Tag>}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
