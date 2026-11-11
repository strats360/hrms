import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Star } from "lucide-react";
import { fmtDate, PRIORITIES, PRIORITY_LABEL, TICKET_STATUS_LABEL, type Priority, type TicketStatus } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { multipart, ReplyBox, StatusTag, Thread, whenShort, type Message } from "@/components/helpdesk/Thread";

interface Category { key: string; label: string; team: string; teamLabel: string }
interface Item { id: string; number: string; subject: string; categoryLabel: string; status: TicketStatus; priority: Priority; lastActivityAt: string; createdAt: string; rating: number | null }

export default function EssHelpdesk() {
  const q = useQuery({ queryKey: ["helpdesk", "mine"], queryFn: () => api.get<{ categories: Category[]; tickets: Item[] }>("/ess/helpdesk") });
  const [raising, setRaising] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const open = q.data.tickets.filter((t) => !["resolved", "closed"].includes(t.status));
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="!mb-1 text-[26px]">Helpdesk</h1>
          <div className="text-muted text-[13.5px]">Ask HR, IT, Finance or Admin. You'll get replies here and by email.</div>
        </div>
        <Button variant="primary" onClick={() => setRaising(true)}><Plus size={16} /> Ask a question</Button>
      </div>
      {!q.data.tickets.length ? (
        <Card><Empty title="No tickets yet" sub="Questions about pay, leave, your laptop or the office go here." action={<Button onClick={() => setRaising(true)}>Ask a question</Button>} /></Card>
      ) : (
        <Card padded={false} className="!gap-0 overflow-hidden">
          {[...open, ...q.data.tickets.filter((t) => !open.includes(t))].map((t) => (
            <Link key={t.id} to={`/me/helpdesk/${t.id}`} className="flex items-center gap-3 border-b border-[var(--color-divider)] px-4 py-3 no-underline last:border-b-0" style={{ color: "inherit" }}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{t.subject}</div>
                <div className="text-muted text-[12px]">{t.number} · {t.categoryLabel} · updated {whenShort(t.lastActivityAt)}</div>
              </div>
              <StatusTag s={t.status} label={TICKET_STATUS_LABEL[t.status]} />
              <ChevronRight size={16} className="text-muted flex-none" />
            </Link>
          ))}
        </Card>
      )}
      {raising ? <NewTicket categories={q.data.categories} onClose={() => setRaising(false)} /> : null}
    </>
  );
}

function NewTicket({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [f, setF] = useState({ categoryKey: "", subject: "", body: "", priority: "normal" as Priority, confidential: false });
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>("/ess/helpdesk", multipart(f, file)),
    onSuccess: (r) => (toast.success(`${r.number} sent. We'll reply here and by email.`), qc.invalidateQueries({ queryKey: ["helpdesk"] }), onClose(), nav(`/me/helpdesk/${r.id}`)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const teams = [...new Set(categories.map((c) => c.teamLabel))];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Ask a question" width={620} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.categoryKey || f.subject.trim().length < 4 || f.body.trim().length < 10} loading={save.isPending} onClick={() => save.mutate()}>Send</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What's it about" span>
          <Select value={f.categoryKey} onChange={(e) => setF({ ...f, categoryKey: e.target.value })}>
            <option value="">Choose</option>
            {teams.map((t) => <optgroup key={t} label={t}>{categories.filter((c) => c.teamLabel === t).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
          </Select>
        </Field>
        <Field label="Subject" span><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. October payslip is missing HRA" maxLength={150} /></Field>
        <Field label="Details" span><Textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="How urgent"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
        <Field label="Attachment (optional)" hint="A screenshot or PDF"><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12.5px]" /></Field>
        <div className="sm:col-span-2"><Checkbox checked={f.confidential} onChange={(v) => setF({ ...f, confidential: v })} label="It's personal or sensitive: only senior HR should see it" /></div>
      </div>
    </Dialog>
  );
}

export function EssTicket() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["helpdesk", "mine", id], queryFn: () => api.get<{ id: string; number: string; subject: string; categoryLabel: string; teamLabel: string; status: TicketStatus; priority: Priority; confidential: boolean; assignee: string | null; createdAt: string; rating: number | null; messages: Message[] }>(`/ess/helpdesk/${id}`) });
  const reply = useMutation({
    mutationFn: (a: { body: string; file: File | null }) => api.post(`/ess/helpdesk/${id}/reply`, multipart({ body: a.body }, a.file)),
    onSuccess: () => (toast.success("Sent"), qc.invalidateQueries({ queryKey: ["helpdesk"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const rate = useMutation({
    mutationFn: () => api.post(`/ess/helpdesk/${id}/rate`, { rating: stars, comment }),
    onSuccess: () => (toast.success("Thanks for the feedback"), qc.invalidateQueries({ queryKey: ["helpdesk"] })),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const t = q.data;
  return (
    <>
      <Link to="/me/helpdesk" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> All tickets</Link>
      <Card className="!gap-3">
        <CardHeader title={t.subject} sub={`${t.number} · ${t.categoryLabel} · ${t.teamLabel}${t.assignee ? ` · with ${t.assignee}` : ""} · raised ${fmtDate(t.createdAt.slice(0, 10))}`} actions={<StatusTag s={t.status} label={TICKET_STATUS_LABEL[t.status]} />} />
        {t.status === "waiting" ? <Notice tone="warn">The team needs something from you. Reply below.</Notice> : null}
        {t.status === "resolved" ? <Notice tone="ok">Marked resolved. If it isn't sorted, reply and it reopens.</Notice> : null}
        <Thread messages={t.messages} fileBase={`/ess/helpdesk/${id}/messages`} />
        {t.status !== "closed" ? <ReplyBox placeholder="Write a reply" busy={reply.isPending} onSend={(body, file) => reply.mutateAsync({ body, file })} /> : null}
      </Card>
      {(t.status === "resolved" || t.status === "closed") && !t.rating ? (
        <Card className="!gap-2">
          <CardHeader title="How did we do?" sub={t.status === "resolved" ? "Rating it also closes the ticket." : undefined} />
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setStars(n)} className="p-1"><Star size={24} fill={n <= stars ? "var(--color-accent)" : "none"} color="var(--color-accent)" /></button>)}
          </div>
          <Textarea rows={2} aria-label="Comment" placeholder="Anything to add (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex justify-end"><Button variant="primary" disabled={!stars} loading={rate.isPending} onClick={() => rate.mutate()}>Send rating</Button></div>
        </Card>
      ) : t.rating ? <div className="text-muted text-[12.5px]">You rated this {t.rating} out of 5.</div> : null}
    </>
  );
}
