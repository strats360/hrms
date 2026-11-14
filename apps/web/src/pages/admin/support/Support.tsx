import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus, ShieldCheck } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Ticket, TicketDetail } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Segmented, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { ago, CATEGORY_LABEL, formOf, PriorityTag, ReplyBox, Thread, TicketStatusTag } from "@/components/support/shared";

type F = "open" | "all";

export default function Support() {
  const { tenant } = useSession();
  const readOnly = !!tenant?.support;
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<F>("open");
  const [creating, setCreating] = useState(false);
  const open = params.get("ticket");
  const q = useQuery({ queryKey: ["support"], queryFn: () => api.get<Ticket[]>("/admin/support") });
  const rows = (q.data ?? []).filter((t) => filter === "all" || !["resolved", "closed"].includes(t.status));
  const columns = useMemo<ColumnDef<Ticket, any>[]>(
    () => [
      { id: "number", header: "Ticket", accessorFn: (t) => t.number, cell: ({ row: { original: t } }) => <div><div className="font-medium">#{t.number} · {t.subject}</div><div className="text-muted text-[12px]">{CATEGORY_LABEL[t.category] ?? t.category} · raised by {t.raisedByName ?? "—"}</div></div> },
      { id: "priority", header: "Priority", accessorFn: (t) => t.priority, cell: ({ row: { original: t } }) => <PriorityTag p={t.priority} /> },
      { id: "status", header: "Status", accessorFn: (t) => t.status, cell: ({ row: { original: t } }) => <TicketStatusTag status={t.status} forCustomer /> },
      { id: "owner", header: "Support contact", accessorFn: (t) => t.assigneeName ?? "", cell: ({ getValue }) => getValue<string>() || <span className="text-muted">Not assigned yet</span> },
      { id: "updated", header: "Last update", accessorFn: (t) => t.lastActivityAt, cell: ({ getValue }) => ago(getValue<string>()) },
    ],
    [],
  );
  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("ticket", id);
    else p.delete("ticket");
    setParams(p);
  };
  return (
    <>
      <PageHeader
        title="Product support"
        sub="Contact the Strats360 People team about the software, billing or your account. Questions from your employees go to Helpdesk instead. P1 is answered within 1 hour, P2 within 4 hours, P3 within 1 business day."
        actions={
          !readOnly ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New ticket
            </Button>
          ) : null
        }
      />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(t) => t.id}
          loading={q.isFetching}
          columnToggle={false}
          onRowClick={(t) => setOpen(t.id)}
          empty={filter === "open" ? "No open tickets" : "No tickets yet"}
          toolbar={<Segmented<F> value={filter} onChange={setFilter} options={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]} />}
        />
      </TableCard>
      <NewTicketDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />
      <TicketDialog id={open} onClose={() => setOpen(null)} readOnly={readOnly} />
    </>
  );
}

function NewTicketDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ subject: "", category: "payroll", priority: "P3", body: "", allowAccess: false });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => api.upload<Ticket>("/admin/support", formOf(f, files)),
    onSuccess: (t) => {
      toast.success(`Ticket #${t.number} raised. We'll reply by email and here.`);
      qc.invalidateQueries({ queryKey: ["support"] });
      setF({ subject: "", category: "payroll", priority: "P3", body: "", allowAccess: false });
      setFiles([]);
      onClose();
      onCreated(t.id);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="New ticket to Strats360 People"
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Raise ticket
          </Button>
        </>
      }
    >
      <Field label="Subject">
        <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={140} placeholder="Bank file rejected by HDFC" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Area">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" hint={f.priority === "P1" ? "Payroll or payments blocked for everyone" : f.priority === "P2" ? "Something important is wrong, with a workaround" : "Questions and minor issues"}>
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="P1">P1 · urgent, reply within 1 hour</option>
            <option value="P2">P2 · high, within 4 hours</option>
            <option value="P3">P3 · normal, within 1 business day</option>
          </Select>
        </Field>
      </div>
      <Field label="What's happening?" hint="Steps, the employee or month affected, and what you expected">
        <Textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={5000} />
      </Field>
      <Field label="Screenshots or files (optional, up to 3)">
        <input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} />
      </Field>
      <Checkbox checked={f.allowAccess} onChange={(v) => setF({ ...f, allowAccess: v })} label="Allow support to view our account read-only while this ticket is open" />
      <div className="text-muted -mt-1 text-[12px]">Support can look but can't change or download anything. Each visit lasts up to an hour and is recorded on the ticket and in your audit log. You can switch this off at any time.</div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Dialog>
  );
}

function TicketDialog({ id, onClose, readOnly }: { id: string | null; onClose: () => void; readOnly: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["support", id], queryFn: () => api.get<TicketDetail>(`/admin/support/${id}`), enabled: !!id });
  const refresh = () => qc.invalidateQueries({ queryKey: ["support"] });
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch(`/admin/support/${id}`, b), onSuccess: () => refresh() });
  const t = q.data;
  const closed = t?.status === "closed";
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} title={t ? `#${t.number} · ${t.subject}` : "Ticket"} description={t ? `${CATEGORY_LABEL[t.category] ?? t.category} · raised ${fmtDate(t.createdAt.slice(0, 10))} by ${t.raisedByName ?? "—"}` : undefined} width={720}>
      {q.isLoading ? <Loading /> : null}
      {t ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityTag p={t.priority} />
            <TicketStatusTag status={t.status} forCustomer />
            {t.assigneeName ? <span className="text-muted text-[13px]">Support contact: {t.assigneeName}</span> : null}
            {!readOnly && !["resolved", "closed"].includes(t.status) ? (
              <Button size="sm" className="ml-auto" loading={patch.isPending} onClick={() => patch.mutate({ status: "resolved" }, { onSuccess: () => toast.success("Marked resolved") })}>
                Mark resolved
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-[13px]" style={{ background: "var(--tint-1)" }}>
            <span className="flex items-center gap-2">
              <ShieldCheck size={15} /> {t.allowAccess ? "Support may view your account read-only while this ticket is open." : "Support can't view your account for this ticket."}
            </span>
            {!readOnly && !closed ? (
              <Button size="sm" onClick={() => patch.mutate({ allowAccess: !t.allowAccess }, { onSuccess: () => toast.success(t.allowAccess ? "Access withdrawn. Any open session has ended." : "Read-only access allowed") })}>
                {t.allowAccess ? "Withdraw access" : "Allow access"}
              </Button>
            ) : null}
          </div>
          {t.accessLog.length ? (
            <div className="text-muted text-[12px]">
              Support visits:{" "}
              {t.accessLog
                .map((a) => `${a.staffName}, ${new Date(a.startedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}${a.endedAt ? "" : Date.parse(a.expiresAt) > Date.now() ? " (now)" : ""}`)
                .join(" · ")}
            </div>
          ) : null}
          <div className="max-h-[45vh] overflow-auto pr-1">
            <Thread messages={t.thread} attachmentBase="/admin/support/attachments" viewer="tenant" />
          </div>
          {closed ? (
            <Notice tone="sel">This ticket is closed. Raise a new one if you need more help.</Notice>
          ) : (
            <ReplyBox
              disabled={readOnly}
              placeholder={t.status === "resolved" ? "Reply to reopen this ticket" : "Write a reply"}
              onSend={async (body, files) => {
                await api.upload(`/admin/support/${t.id}/messages`, formOf({ body }, files));
                refresh();
              }}
            />
          )}
        </>
      ) : null}
    </Dialog>
  );
}
