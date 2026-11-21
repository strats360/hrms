import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Lock } from "lucide-react";
import { CASE_STATUS_LABELS, fmtDate, todayLocal, type CaseStatus, type CommitteeKind } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface Brief {
  id: string;
  code: string;
  kind: CommitteeKind;
  subject: string;
  filedOn: string;
  status: CaseStatus;
  deadlines: { inquiryBy: string };
}
interface Overview {
  committees: { id: string; kind: CommitteeKind; name: string; label: string }[];
  mine: Brief[];
  assigned: Brief[];
}
interface CaseView {
  id: string;
  code: string;
  kind: CommitteeKind;
  committee: { name: string };
  subject: string;
  description: string;
  incidentDate: string | null;
  filedOn: string;
  status: CaseStatus;
  outcome: string | null;
  complainant: string | null;
  respondent: string | null;
  deadlines: { inquiryBy: string; reportBy: string; actionBy: string; filingNote: string | null };
  asMember: boolean;
  notes: { id: string; kind: string; status: string | null; body: string | null; author: string | null; at: string; shared: boolean }[];
}

const OPEN = (s: CaseStatus) => s !== "closed" && s !== "withdrawn";
const tone = (s: CaseStatus) => (OPEN(s) ? "warn" : s === "closed" ? "ok" : "neutral");

function CaseList({ title, rows, empty }: { title: string; rows: Brief[]; empty: string }) {
  return (
    <Card className="!gap-2">
      <CardHeader title={title} />
      {!rows.length ? <div className="text-muted text-[13.5px]">{empty}</div> : null}
      {rows.map((r) => (
        <Link key={r.id} to={`/me/committees/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-2 no-underline hover:bg-[var(--tint-1)]">
          <span className="min-w-0"><b className="font-semibold">{r.code}</b> {r.subject} <span className="text-muted text-[12.5px]">filed {fmtDate(r.filedOn)}</span></span>
          <span className="flex items-center gap-2">
            {OPEN(r.status) && r.deadlines.inquiryBy < todayLocal() ? <Tag tone="bad">Past the time limit</Tag> : null}
            <Tag tone={tone(r.status)}>{CASE_STATUS_LABELS[r.status]}</Tag>
          </span>
        </Link>
      ))}
    </Card>
  );
}

/** Bring a complaint to the POSH Internal Committee or a grievance to the Grievance Redressal Committee. */
export default function EssCommittees() {
  const { id } = useParams();
  if (id) return <CaseDetail id={id} />;
  return <Overview />;
}

function Overview() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["ess", "committees"], queryFn: () => api.get<Overview>("/ess/committees") });
  const [f, setF] = useState<{ kind: CommitteeKind | ""; subject: string; description: string; incidentDate: string; respondentName: string }>({ kind: "", subject: "", description: "", incidentDate: "", respondentName: "" });
  const file = useMutation({
    mutationFn: () => api.post<{ id: string; code: string }>("/ess/committees/cases", { kind: f.kind, subject: f.subject, description: f.description, incidentDate: f.incidentDate || null, respondentName: f.respondentName || null }),
    onSuccess: (r) => {
      toast.success(`${r.code} is with the committee`);
      qc.invalidateQueries({ queryKey: ["ess", "committees"] });
      nav(`/me/committees/${r.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <Card className="!gap-3">
        <CardHeader title="Raise a concern" sub="Your case goes only to the committee's members. HR doesn't see it, and the person you name isn't told by Saralix." />
        {!d.committees.length ? (
          <Notice tone="sel">Your company hasn't set up its committees yet. You can still speak to HR or a manager you trust.</Notice>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who it goes to">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CommitteeKind })}>
                <option value="">Pick one</option>
                {d.committees.map((k) => <option key={k.id} value={k.kind}>{k.kind === "posh_ic" ? "Sexual harassment: the Internal Committee" : "Any other workplace grievance: the Grievance Committee"}</option>)}
              </Select>
            </Field>
            <Field label="When it happened" hint={f.kind === "posh_ic" ? "Within three months is best; the committee can accept later ones" : undefined}><Input type="date" max={todayLocal()} value={f.incidentDate} onChange={(e) => setF({ ...f, incidentDate: e.target.value })} /></Field>
            <Field label="In a few words" span><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
            <Field label="Who it's about (optional)" span><Input value={f.respondentName} onChange={(e) => setF({ ...f, respondentName: e.target.value })} /></Field>
            <Field label="What happened" span><Textarea rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What happened, where, and anyone who saw it" /></Field>
            <div className="sm:col-span-2"><Button variant="primary" disabled={!f.kind} loading={file.isPending} onClick={() => file.mutate()}><Lock size={14} /> Send to the committee</Button></div>
          </div>
        )}
      </Card>
      <CaseList title="Your cases" rows={d.mine} empty="You haven't raised anything." />
      {d.assigned.length ? <CaseList title="Cases before your committee" rows={d.assigned} empty="" /> : null}
    </div>
  );
}

function CaseDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ess", "committees", id], queryFn: () => api.get<CaseView>(`/ess/committees/cases/${id}`) });
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<CaseStatus | "">("");
  const [share, setShare] = useState(false);
  const [outcome, setOutcome] = useState("");
  const send = useMutation({
    mutationFn: (b: Record<string, unknown>) => api.post(`/ess/committees/cases/${id}/notes`, b),
    onSuccess: () => {
      setBody("");
      setStatus("");
      setOutcome("");
      qc.invalidateQueries({ queryKey: ["ess", "committees"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const c = q.data!;
  const open = OPEN(c.status);
  return (
    <div className="flex flex-col gap-4">
      <Link to="/me/committees" className="inline-flex items-center gap-1 text-[13px] no-underline"><ChevronLeft size={15} /> All cases</Link>
      <Card className="!gap-3">
        <CardHeader title={`${c.code}: ${c.subject}`} sub={`${c.committee.name} · filed ${fmtDate(c.filedOn)}${c.incidentDate ? ` · happened ${fmtDate(c.incidentDate)}` : ""}`} actions={<Tag tone={tone(c.status)}>{CASE_STATUS_LABELS[c.status]}</Tag>} />
        {c.asMember ? <div className="text-[13.5px]">Raised by <b className="font-semibold">{c.complainant}</b>{c.respondent ? <> about <b className="font-semibold">{c.respondent}</b></> : null}</div> : null}
        <div className="whitespace-pre-wrap text-[14px]">{c.description}</div>
        {c.deadlines.filingNote && c.asMember ? <Notice tone="warn">{c.deadlines.filingNote}.</Notice> : null}
        {open ? (
          <div className="text-muted text-[13px]">
            {c.kind === "posh_ic" ? `Inquiry to finish by ${fmtDate(c.deadlines.inquiryBy)}; report within 10 days after; the employer acts within 60 days of the report.` : `The committee decides by ${fmtDate(c.deadlines.inquiryBy)}. If you disagree, you can appeal to the employer, who decides within 30 days.`}
          </div>
        ) : null}
        {c.outcome ? <Notice tone="ok">Outcome: {c.outcome}</Notice> : null}
      </Card>

      <Card className="!gap-3">
        <CardHeader title="History" sub={c.asMember ? "Notes stay within the committee unless you share them. Status changes are always shared." : undefined} />
        {c.notes.map((n) => (
          <div key={n.id} className="border-s-2 border-[var(--color-border)] ps-3 text-[13.5px]">
            <div className="text-muted text-[12px]">{new Date(n.at).toLocaleString("en-IN")} · {n.author ?? "Saralix"}{c.asMember && n.kind === "note" ? (n.shared ? " · shared" : " · committee only") : ""}</div>
            {n.status ? <div className="font-semibold">{CASE_STATUS_LABELS[n.status as CaseStatus]}</div> : null}
            {n.body ? <div className="whitespace-pre-wrap">{n.body}</div> : null}
          </div>
        ))}
        {open ? (
          <div className="flex flex-col gap-2">
            <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={c.asMember ? "A note for the case" : "A message to the committee"} />
            {c.asMember ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)} aria-label="Move to">
                  <option value="">Keep the status</option>
                  {(["conciliation", "inquiry", "report", "action", "closed"] as const).map((s) => <option key={s} value={s}>{CASE_STATUS_LABELS[s]}</option>)}
                </Select>
                <Checkbox checked={share} onChange={setShare} label="Share this note with the person who raised it" />
                {status === "closed" || status === "report" ? <Textarea className="sm:col-span-2" rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Findings, recommendation and action taken" /> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={send.isPending} onClick={() => send.mutate({ body: body || undefined, ...(c.asMember ? { status: status || undefined, share, outcome: outcome || undefined } : {}) })}>{c.asMember ? "Save" : "Send"}</Button>
              {!c.asMember ? <Button onClick={() => send.mutate({ status: "withdrawn", body: body || undefined })}>Withdraw</Button> : null}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
