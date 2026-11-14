import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Lock } from "lucide-react";
import { AGENT_STATUS_LABEL, PRIORITIES, PRIORITY_LABEL, TICKET_STATUSES, type HelpdeskCategory, type Priority, type TicketStatus } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Select } from "@/components/ui/field";
import { ErrorState, KV, Loading, Notice, PageHeader } from "@/components/ui/page";
import { multipart, ReplyBox, StatusTag, Thread, whenShort, type Message } from "@/components/helpdesk/Thread";
import { useLookups } from "@/components/recruitment/shared";
import { SearchSelect } from "@/components/ui/search-select";

interface Detail {
  id: string;
  number: string;
  subject: string;
  categoryKey: string;
  categoryLabel: string;
  teamLabel: string;
  status: TicketStatus;
  priority: Priority;
  confidential: boolean;
  assigneeId: string | null;
  responseDueAt: string;
  firstResponseAt: string | null;
  createdAt: string;
  rating: number | null;
  ratingComment: string | null;
  raiser: { id: string; name: string; code: string; email: string };
  messages: Message[];
  categories: HelpdeskCategory[];
  teamMembers: string[];
  history: { id: string; number: string; subject: string; status: TicketStatus; createdAt: string }[];
}

export default function Ticket() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { can, tenant } = useSession();
  const L = useLookups();
  const q = useQuery({ queryKey: ["helpdesk", "ticket", id], queryFn: () => api.get<Detail>(`/admin/helpdesk/${id}`) });
  const [internal, setInternal] = useState(false);
  const [then, setThen] = useState<"" | "waiting" | "resolved">("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["helpdesk"] });
  const reply = useMutation({
    mutationFn: (a: { body: string; file: File | null }) => api.post(`/admin/helpdesk/${id}/reply`, multipart({ body: a.body, internal, ...(then ? { status: then } : {}) }, a.file)),
    onSuccess: () => (toast.success(internal ? "Note added" : "Reply sent"), setThen(""), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: (b: Record<string, unknown>) => api.patch(`/admin/helpdesk/${id}`, b),
    onSuccess: () => (toast.success("Updated"), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const t = q.data;
  const edit = can("helpdesk", "edit");
  const people = (L.data?.employees ?? []).filter((e) => e.id !== t.raiser.id);
  const team = people.filter((e) => t.teamMembers.includes(e.id));
  const others = people.filter((e) => !t.teamMembers.includes(e.id));
  const ownTicket = t.raiser.id === tenant?.employeeId;
  return (
    <>
      <Link to="/helpdesk" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> All tickets</Link>
      <PageHeader title={t.subject} sub={`${t.number} · ${t.categoryLabel} · ${t.teamLabel} · from ${t.raiser.name}`} actions={<StatusTag s={t.status} label={AGENT_STATUS_LABEL[t.status]} />} />
      {t.confidential ? <Notice tone="warn"><Lock size={13} className="inline" /> Confidential. Only HR leads and the person it's assigned to can see it.</Notice> : null}
      {!t.firstResponseAt && t.status === "open" ? <Notice tone={new Date(t.responseDueAt) < new Date() ? "bad" : "sel"}>{new Date(t.responseDueAt) < new Date() ? "The first reply is overdue. It was due" : "Reply by"} {whenShort(t.responseDueAt)}.</Notice> : null}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="!gap-3">
          <Thread messages={t.messages} fileBase={`/admin/helpdesk/${id}/messages`} />
          {edit && t.status !== "closed" ? (
            <ReplyBox
              placeholder={internal ? "A note for the team. The employee won't see it." : `Reply to ${t.raiser.name.split(" ")[0]}`}
              busy={reply.isPending}
              sendLabel={internal ? "Add note" : then === "resolved" ? "Send and resolve" : "Send reply"}
              onSend={(body, file) => reply.mutateAsync({ body, file })}
              extra={
                <>
                  <Checkbox checked={internal} onChange={(v) => (setInternal(v), v && setThen(""))} label="Team note" />
                  {!internal ? (
                    <Select aria-label="Then" value={then} onChange={(e) => setThen(e.target.value as typeof then)} className="!w-[190px]">
                      <option value="">Keep it open</option>
                      <option value="waiting">Wait for their answer</option>
                      <option value="resolved">Mark resolved</option>
                    </Select>
                  ) : null}
                </>
              }
            />
          ) : null}
          {ownTicket ? <div className="text-muted text-[12.5px]">This is your own ticket, so someone else on the team answers it. You can still add team notes.</div> : null}
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="!gap-3">
            <Field label="Status"><Select disabled={!edit} value={t.status} onChange={(e) => update.mutate({ status: e.target.value })}>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{AGENT_STATUS_LABEL[s]}</option>)}</Select></Field>
            <Field label="Priority"><Select disabled={!edit} value={t.priority} onChange={(e) => update.mutate({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
            <Field label="Assigned to">
              <SearchSelect disabled={!edit} value={t.assigneeId ?? ""} onChange={(v) => update.mutate({ assigneeId: v || null })} emptyLabel="Nobody yet" searchPlaceholder="Search people" options={[...team.map((e) => ({ value: e.id, label: e.name, group: t.teamLabel })), ...others.map((e) => ({ value: e.id, label: e.name, group: "Others" }))]} />
            </Field>
            <Field label="Category"><Select disabled={!edit} value={t.categoryKey} onChange={(e) => update.mutate({ categoryKey: e.target.value })}>{t.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select></Field>
            {t.rating ? <KV label="Their rating">{t.rating} / 5{t.ratingComment ? `: ${t.ratingComment}` : ""}</KV> : null}
          </Card>
          <Card className="!gap-2">
            <CardHeader title={t.raiser.name} sub={`${t.raiser.code} · ${t.raiser.email}`} />
            <Link to={`/employees/${t.raiser.id}`} className="text-[13px]">Open their profile</Link>
            {t.history.length ? (
              <div className="flex flex-col gap-1 border-t border-[var(--color-divider)] pt-2">
                <div className="text-muted text-[12px]">Their other tickets</div>
                {t.history.map((h) => <Link key={h.id} to={`/helpdesk/${h.id}`} className="truncate text-[13px]">{h.number} {h.subject}</Link>)}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
