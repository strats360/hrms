import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { BREACH_STATUSES, CONSENT_PURPOSE_LABELS, CONSENT_PURPOSES, fmtDate, type BreachStatus } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface Breach {
  id: string;
  code: string;
  discoveredAt: string;
  description: string;
  dataAffected: string;
  affectedCount: number;
  status: BreachStatus;
  boardIntimatedAt: string | null;
  boardReportAt: string | null;
  peopleNotifiedAt: string | null;
  actions: string;
  reportDue: string;
  overdue: boolean;
  open: string[];
}
interface Data {
  notice: { version: number; text: string; publishedAt: string | null };
  acknowledgements: { acknowledged: number; employees: number };
  consents: Record<string, { granted: number; withdrawn: number }>;
  conflicts: string[];
  retention: { years: number; due: { employeeId: string; code: string; name: string; lastWorkingDay: string | null; from: string | null }[] };
  breaches: Breach[];
}

const local = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
const fromLocal = (s: string) => (s ? new Date(s).toISOString() : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** Privacy notice, consents, retention and breaches, for HR. */
export function DpdpAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dpdp"], queryFn: () => api.get<Data>("/admin/dpdp") });
  const [notice, setNotice] = useState<string | null>(null);
  const [breach, setBreach] = useState<Partial<Breach> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["dpdp"] });
  const publish = useMutation({
    mutationFn: () => api.post<{ version: number }>("/admin/dpdp/notice", { text: notice }),
    onSuccess: (r) => {
      toast.success(`Version ${r.version} published. Employees will be asked to read it.`);
      setNotice(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveBreach = useMutation({
    mutationFn: (b: Partial<Breach>) => {
      const body = { discoveredAt: b.discoveredAt, description: b.description, dataAffected: b.dataAffected ?? "", affectedCount: b.affectedCount ?? 0, status: b.status ?? "open", boardIntimatedAt: b.boardIntimatedAt || null, boardReportAt: b.boardReportAt || null, peopleNotifiedAt: b.peopleNotifiedAt || null, actions: b.actions ?? "" };
      return b.id ? api.put(`/admin/dpdp/breaches/${b.id}`, body) : api.post("/admin/dpdp/breaches", body);
    },
    onSuccess: () => {
      setBreach(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  const d = q.data;
  if (!d) return null;
  return (
    <>
      <Card className="!gap-3">
        <CardHeader
          title="Privacy notice"
          sub={`What you collect, why, and employees' rights. ${d.notice.version ? `Version ${d.notice.version}, published ${when(d.notice.publishedAt)}.` : "Not published yet; employees see the starting text below."} ${d.acknowledgements.acknowledged} of ${d.acknowledgements.employees} employees have read the current version.`}
          actions={<Button onClick={() => setNotice(d.notice.text)}>{d.notice.version ? "Edit and publish" : "Review and publish"}</Button>}
        />
        <div className="text-muted max-h-40 overflow-auto whitespace-pre-wrap text-[13px]">{d.notice.text}</div>
      </Card>

      <Card className="!gap-3">
        <CardHeader title="Consents" sub="Running employment doesn't need consent under the DPDP Act. These optional uses do, and employees can give or withdraw them from their account page." />
        {d.conflicts.map((x) => <Notice key={x} tone="warn">{x}</Notice>)}
        {CONSENT_PURPOSES.map((p) => (
          <div key={p} className="flex flex-wrap justify-between gap-2 text-[13.5px]">
            <span>{CONSENT_PURPOSE_LABELS[p].title}</span>
            <span className="text-muted">{d.consents[p]?.granted ?? 0} gave consent · {d.consents[p]?.withdrawn ?? 0} withdrew or said no</span>
          </div>
        ))}
      </Card>

      <Card className="!gap-3">
        <CardHeader title="Retention" sub={`Former employees' data is kept for ${d.retention.years} years after they leave (change it in the data request settings), then erased. Tell the person 48 hours before you erase.`} actions={d.retention.due.length ? <Tag tone="warn">{d.retention.due.length} due</Tag> : <Tag tone="ok">Nothing due</Tag>} />
        {d.retention.due.slice(0, 30).map((r) => (
          <div key={r.employeeId} className="flex flex-wrap justify-between gap-2 text-[13.5px]">
            <span><Link to={`/employees/${r.employeeId}`} className="font-semibold">{r.name}</Link> <span className="text-muted">{r.code} · left {r.lastWorkingDay ? fmtDate(r.lastWorkingDay) : ""}</span></span>
            <span className="text-muted">due since {r.from ? fmtDate(r.from) : ""}</span>
          </div>
        ))}
      </Card>

      <Card className="!gap-3">
        <CardHeader title="Data breaches" sub="If personal data is lost, leaked or seen by someone who shouldn't see it, tell the Data Protection Board without delay, send it a full report within 72 hours, and tell the people affected." actions={<Button onClick={() => setBreach({ discoveredAt: new Date().toISOString(), status: "open" })}><Plus size={14} /> Log a breach</Button>} />
        {!d.breaches.length ? <div className="text-muted text-[13.5px]">None logged.</div> : null}
        {d.breaches.map((b) => (
          <button key={b.id} type="button" onClick={() => setBreach(b)} className="flex flex-col items-start gap-1 rounded-[var(--radius-md)] px-2 py-2 text-left hover:bg-[var(--tint-1)]">
            <span className="flex flex-wrap items-center gap-2"><b className="font-semibold">{b.code}</b> <span className="text-[13.5px]">{b.description.slice(0, 90)}</span> <Tag tone={b.status === "closed" ? "ok" : "warn"}>{b.status}</Tag>{b.overdue ? <Tag tone="bad">Report overdue</Tag> : null}</span>
            <span className="text-muted text-[12.5px]">Found {when(b.discoveredAt)} · {b.affectedCount} people · full report due {when(b.reportDue)}{b.open.length ? ` · to do: ${b.open.join("; ").toLowerCase()}` : ""}</span>
          </button>
        ))}
      </Card>

      {notice !== null ? (
        <Dialog open onOpenChange={(v) => !v && setNotice(null)} title="Privacy notice" width={720} footer={<><Button onClick={() => setNotice(null)}>Cancel</Button><Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>Publish as version {d.notice.version + 1}</Button></>}>
          <Textarea rows={18} value={notice} onChange={(e) => setNotice(e.target.value)} />
          <div className="text-muted mt-2 text-[12.5px]">Plain language, in English and in a language your employees read. Publishing asks everyone to read it again.</div>
        </Dialog>
      ) : null}

      {breach ? (
        <Dialog open onOpenChange={(v) => !v && setBreach(null)} title={breach.code ?? "Log a breach"} width={640} footer={<><Button onClick={() => setBreach(null)}>Cancel</Button><Button variant="primary" loading={saveBreach.isPending} onClick={() => saveBreach.mutate(breach)}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Found at"><Input type="datetime-local" value={local(breach.discoveredAt ?? null)} onChange={(e) => setBreach({ ...breach, discoveredAt: fromLocal(e.target.value) ?? undefined })} /></Field>
            <Field label="Status">
              <Select value={breach.status ?? "open"} onChange={(e) => setBreach({ ...breach, status: e.target.value as BreachStatus })}>
                {BREACH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="What happened" span><Textarea rows={3} value={breach.description ?? ""} onChange={(e) => setBreach({ ...breach, description: e.target.value })} /></Field>
            <Field label="Data affected"><Input value={breach.dataAffected ?? ""} onChange={(e) => setBreach({ ...breach, dataAffected: e.target.value })} placeholder="Names, salaries, bank accounts" /></Field>
            <Field label="People affected"><Input type="number" min={0} value={breach.affectedCount ?? 0} onChange={(e) => setBreach({ ...breach, affectedCount: Number(e.target.value) || 0 })} /></Field>
            <Field label="Board told"><Input type="datetime-local" value={local(breach.boardIntimatedAt ?? null)} onChange={(e) => setBreach({ ...breach, boardIntimatedAt: fromLocal(e.target.value) })} /></Field>
            <Field label="Full report sent" hint="Within 72 hours"><Input type="datetime-local" value={local(breach.boardReportAt ?? null)} onChange={(e) => setBreach({ ...breach, boardReportAt: fromLocal(e.target.value) })} /></Field>
            <Field label="People told"><Input type="datetime-local" value={local(breach.peopleNotifiedAt ?? null)} onChange={(e) => setBreach({ ...breach, peopleNotifiedAt: fromLocal(e.target.value) })} /></Field>
            <Field label="What you've done" span><Textarea rows={3} value={breach.actions ?? ""} onChange={(e) => setBreach({ ...breach, actions: e.target.value })} placeholder="Contained, passwords reset, recipient asked to delete" /></Field>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
