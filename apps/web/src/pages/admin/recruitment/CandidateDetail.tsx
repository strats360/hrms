import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, FileText, Mail, Phone } from "lucide-react";
import {
  CLOSED_STAGES,
  fmtDate,
  inr,
  INTERVIEW_MODE_LABEL,
  INTERVIEW_MODES,
  PIPELINE,
  RECOMMENDATION_LABEL,
  SOURCE_LABEL,
  STAGE_LABEL,
  todayIST,
  type Recommendation,
  type Source,
  type Stage,
} from "@hrms/shared";
import { api, errorMessage, getActiveTenant } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { ErrorState, KV, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { lakh, REJECT_REASONS, StageTag, useLookups } from "@/components/recruitment/shared";

export const whenShort = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Open a file from the API in a new tab (it needs the session and company headers). */
export async function openFile(path: string) {
  const w = window.open("", "_blank");
  try {
    const res = await fetch(`/api${path}`, { credentials: "include", headers: getActiveTenant() ? { "X-Tenant-Id": getActiveTenant()! } : {} });
    if (!res.ok) throw new Error("Couldn't open the file");
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (e) {
    w?.close();
    toast.error(errorMessage(e));
  }
}

interface Panel { employeeId: string; name: string; rating: number | null; recommendation: Recommendation | null; notes: string | null; submittedAt: string | null }
interface Interview { id: string; round: string; scheduledAt: string; durationMinutes: number; mode: keyof typeof INTERVIEW_MODE_LABEL; location: string | null; status: "scheduled" | "done" | "cancelled"; panel: Panel[] }
interface Event { id: string; kind: string; fromStage: Stage | null; toStage: Stage | null; note: string | null; byName: string | null; createdAt: string }
interface AppRow {
  id: string;
  stage: Stage;
  stageChangedAt: string;
  rejectReason: string | null;
  offeredCtc: number | null;
  joiningDate: string | null;
  job: { id: string; code: string; title: string; status: string };
  canEdit: boolean;
  events: Event[];
  interviews: Interview[];
}
interface Data {
  candidate: { id: string; name: string; email: string; phone: string | null; currentCompany: string | null; currentTitle: string | null; experienceYears: number | null; currentCtc: number | null; expectedCtc: number | null; noticeDays: number | null; location: string | null; source: Source; referredBy: string | null; notes: string | null; hasResume: boolean; employeeId: string | null; createdAt: string };
  canEdit: boolean;
  applications: AppRow[];
}
type Action = { kind: "reject" | "withdraw" | "interview" | "offer" | "hire"; app: AppRow };

export default function CandidateDetail() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const key = ["recruitment", "candidate", id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Data>(`/admin/recruitment/candidates/${id}`) });
  const [action, setAction] = useState<Action | null>(null);
  const done = () => (qc.invalidateQueries({ queryKey: ["recruitment"] }), setAction(null));
  const move = useMutation({
    mutationFn: (a: { app: AppRow; stage: Stage }) => api.post(`/admin/recruitment/applications/${a.app.id}/move`, { stage: a.stage }),
    onSuccess: (_, a) => (toast.success(`Moved to ${STAGE_LABEL[a.stage]}`), done()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { candidate: c, applications } = q.data;
  const focus = params.get("application");
  const sorted = [...applications].sort((a, b) => (a.id === focus ? -1 : b.id === focus ? 1 : 0));
  return (
    <>
      <Link to={sorted[0] ? `/recruitment/jobs/${sorted[0].job.id}` : "/recruitment"} className="inline-flex items-center gap-1 self-start text-[13px] no-underline">
        <ChevronLeft size={15} /> {sorted[0] ? sorted[0].job.title : "Recruitment"}
      </Link>
      <PageHeader
        title={c.name}
        sub={[c.currentTitle, c.currentCompany].filter(Boolean).join(" at ") || SOURCE_LABEL[c.source]}
        actions={c.hasResume ? <Button onClick={() => openFile(`/admin/recruitment/candidates/${c.id}/resume`)}><FileText size={15} /> Resume</Button> : null}
      />
      {c.employeeId ? <Notice tone="ok">Hired. <Link to={`/employees/${c.employeeId}`}>Open their employee profile</Link></Notice> : null}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="!gap-3">
          <div className="flex flex-col gap-1.5 text-[13.5px]">
            <a href={`mailto:${c.email}`} className="inline-flex items-center gap-2"><Mail size={14} /> {c.email}</a>
            {c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-2"><Phone size={14} /> {c.phone}</a> : null}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--color-divider)] pt-3 text-[13.5px]">
            <KV label="Experience">{c.experienceYears != null ? `${c.experienceYears} years` : "—"}</KV>
            <KV label="Notice period">{c.noticeDays != null ? `${c.noticeDays} days` : "—"}</KV>
            <KV label="Current CTC">{c.currentCtc != null ? `₹${lakh(c.currentCtc)}` : "—"}</KV>
            <KV label="Expected CTC">{c.expectedCtc != null ? `₹${lakh(c.expectedCtc)}` : "—"}</KV>
            <KV label="Location">{c.location ?? "—"}</KV>
            <KV label="Source">{SOURCE_LABEL[c.source]}{c.referredBy ? `, by ${c.referredBy}` : ""}</KV>
            <KV label="Added">{fmtDate(c.createdAt.slice(0, 10))}</KV>
          </div>
          {c.notes ? <div className="border-t border-[var(--color-divider)] pt-3 text-[13px]"><div className="text-muted text-[12px]">Notes</div><div className="whitespace-pre-line">{c.notes}</div></div> : null}
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          {sorted.map((app) => (
            <ApplicationCard key={app.id} app={app} onAction={(kind) => setAction({ kind, app })} onMove={(stage) => move.mutate({ app, stage })} />
          ))}
        </div>
      </div>
      {action?.kind === "reject" || action?.kind === "withdraw" ? <CloseDialog action={action} name={c.name} onClose={() => setAction(null)} onDone={done} /> : null}
      {action?.kind === "interview" ? <InterviewDialog app={action.app} name={c.name} onClose={() => setAction(null)} onDone={done} /> : null}
      {action?.kind === "offer" ? <OfferDialog app={action.app} name={c.name} expected={c.expectedCtc} onClose={() => setAction(null)} onDone={done} /> : null}
      {action?.kind === "hire" ? <HireDialog app={action.app} name={c.name} onClose={() => setAction(null)} onDone={done} /> : null}
    </>
  );
}

function ApplicationCard({ app, onAction, onMove }: { app: AppRow; onAction: (k: Action["kind"]) => void; onMove: (s: Stage) => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [note, setNote] = useState("");
  const addNote = useMutation({
    mutationFn: () => api.post(`/admin/recruitment/applications/${app.id}/notes`, { note }),
    onSuccess: () => (setNote(""), qc.invalidateQueries({ queryKey: ["recruitment", "candidate"] })),
  });
  const ivStatus = useMutation({
    mutationFn: (a: { id: string; status: string }) => api.patch(`/admin/recruitment/interviews/${a.id}`, { status: a.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recruitment", "candidate"] }),
  });
  const closed = CLOSED_STAGES.includes(app.stage);
  const canHire = can("recruitment", "edit") && can("employees", "edit");
  const nextStages = PIPELINE.filter((s) => s !== app.stage && s !== "offer");
  const items = app.canEdit
    ? closed
      ? app.stage === "hired"
        ? []
        : [{ label: "Reopen at screening", onSelect: () => onMove("screening") }]
      : [
          ...nextStages.map((s) => ({ label: `Move to ${STAGE_LABEL[s]}`, onSelect: () => onMove(s) })),
          { label: "Schedule interview", onSelect: () => onAction("interview") },
          { label: app.stage === "offer" ? "Change offer" : "Make offer", onSelect: () => onAction("offer") },
          { label: "Candidate withdrew", onSelect: () => onAction("withdraw") },
          { label: "Not going ahead", onSelect: () => onAction("reject"), danger: true },
        ]
    : [];
  return (
    <Card className="!gap-3">
      <CardHeader
        title={<Link to={`/recruitment/jobs/${app.job.id}`} className="no-underline">{app.job.title}</Link>}
        sub={`${app.job.code} · ${STAGE_LABEL[app.stage]} since ${fmtDate(app.stageChangedAt.slice(0, 10))}${app.rejectReason ? ` · ${app.rejectReason}` : ""}`}
        actions={
          <>
            <StageTag s={app.stage} />
            {app.stage === "offer" && canHire ? <Button variant="primary" size="sm" onClick={() => onAction("hire")}>Hire</Button> : null}
            {items.length ? <Menu trigger={<Button size="sm">Move or act</Button>} items={items} /> : null}
          </>
        }
      />
      {app.stage === "offer" && app.offeredCtc ? <Notice tone="sel">Offered {inr(app.offeredCtc)} a year, joining {app.joiningDate ? fmtDate(app.joiningDate) : "—"}. Once they accept, use Hire to set up their employee record and onboarding.</Notice> : null}
      {app.interviews.length ? (
        <div className="flex flex-col gap-2">
          <div className="text-[13.5px] font-medium">Interviews</div>
          {app.interviews.map((iv) => (
            <div key={iv.id} className="rounded-[var(--radius-md)] border border-[var(--color-divider)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13.5px]"><b>{iv.round}</b> <span className="text-muted">· {whenShort(iv.scheduledAt)} · {INTERVIEW_MODE_LABEL[iv.mode]}{iv.location ? ` · ${iv.location}` : ""}</span></div>
                <div className="flex items-center gap-2">
                  <Tag tone={iv.status === "done" ? "ok" : iv.status === "cancelled" ? "outline" : "accent"}>{iv.status === "done" ? "Done" : iv.status === "cancelled" ? "Cancelled" : "Scheduled"}</Tag>
                  {app.canEdit && iv.status === "scheduled" ? <Button size="sm" variant="ghost" onClick={() => ivStatus.mutate({ id: iv.id, status: "cancelled" })}>Cancel</Button> : null}
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {iv.panel.map((p) => (
                  <div key={p.employeeId} className="text-[13px]">
                    <span className="font-medium">{p.name}</span>{" "}
                    {p.submittedAt ? (
                      <>
                        <span className="text-muted">· {p.rating}/5 ·</span> <Tag tone={p.recommendation?.endsWith("yes") ? "ok" : "bad"}>{RECOMMENDATION_LABEL[p.recommendation!]}</Tag>
                        <div className="text-muted whitespace-pre-line">{p.notes}</div>
                      </>
                    ) : (
                      <span className="text-muted">· feedback pending</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="text-[13.5px] font-medium">History</div>
        {app.events.map((e) => (
          <div key={e.id} className="flex gap-3 text-[13px]">
            <span className="text-muted w-[92px] flex-none text-[12px]">{whenShort(e.createdAt)}</span>
            <span className="min-w-0">
              {e.kind === "moved" && e.fromStage && e.toStage ? <b>{STAGE_LABEL[e.fromStage]} to {STAGE_LABEL[e.toStage]}</b> : e.kind === "created" ? <b>Added</b> : null}
              {e.note ? <span className="whitespace-pre-line"> {e.kind === "moved" || e.kind === "created" ? "· " : ""}{e.note}</span> : null}
              {e.byName ? <span className="text-muted"> · {e.byName}</span> : null}
            </span>
          </div>
        ))}
        <form onSubmit={(e) => (e.preventDefault(), note.trim() && addNote.mutate())} className="flex gap-2">
          <Input aria-label="Add a note" placeholder="Add a note for the team" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" loading={addNote.isPending} disabled={!note.trim()}>Add</Button>
        </form>
      </div>
    </Card>
  );
}

function CloseDialog({ action, name, onClose, onDone }: { action: Action; name: string; onClose: () => void; onDone: () => void }) {
  const reject = action.kind === "reject";
  const [reason, setReason] = useState(reject ? REJECT_REASONS[0]! : "");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api.post(`/admin/recruitment/applications/${action.app.id}/move`, { stage: reject ? "rejected" : "withdrawn", reason, note }),
    onSuccess: () => (toast.success(reject ? `${name} marked as not going ahead` : `${name} marked as withdrawn`), onDone()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={reject ? `Not going ahead with ${name}` : `${name} withdrew`} description="They aren't emailed. You can reopen this later." footer={<><Button onClick={onClose}>Cancel</Button><Button variant={reject ? "danger" : "primary"} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        {reject ? <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field> : <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Took another offer" /></Field>}
        <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function InterviewDialog({ app, name, onClose, onDone }: { app: AppRow; name: string; onClose: () => void; onDone: () => void }) {
  const L = useLookups();
  const [f, setF] = useState({ round: app.interviews.length ? "Second round" : "First round", date: todayIST(), time: "11:00", durationMinutes: "45", mode: "video" as (typeof INTERVIEW_MODES)[number], location: "" });
  const [panel, setPanel] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const save = useMutation({
    mutationFn: () => api.post(`/admin/recruitment/applications/${app.id}/interviews`, { round: f.round, scheduledAt: `${f.date}T${f.time}:00+05:30`, durationMinutes: Number(f.durationMinutes), mode: f.mode, location: f.location || null, interviewerIds: panel }),
    onSuccess: () => (toast.success(`Interview scheduled. ${name} and the panel have been emailed.`), onDone()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const people = (L.data?.employees ?? []).filter((e) => panel.includes(e.id) || (find.trim().length >= 2 && `${e.name} ${e.code}`.toLowerCase().includes(find.trim().toLowerCase()))).slice(0, 12);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Interview with ${name}`} width={620} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!panel.length || f.round.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>Schedule and email</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Round" span><Input value={f.round} onChange={(e) => setF({ ...f, round: e.target.value })} placeholder="e.g. Technical, HR, Final" /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Time (IST)"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        <Field label="Duration (minutes)"><Input type="number" min={10} step={5} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} /></Field>
        <Field label="How"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as typeof f.mode })}>{INTERVIEW_MODES.map((m) => <option key={m} value={m}>{INTERVIEW_MODE_LABEL[m]}</option>)}</Select></Field>
        <Field label={f.mode === "video" ? "Meeting link" : f.mode === "phone" ? "Who calls whom" : "Address or room"} span><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Interviewers" span hint="They get an email and add feedback from their self-service">
          <div className="flex flex-col gap-2">
            <Input aria-label="Find an interviewer" placeholder="Type a name to find someone" value={find} onChange={(e) => setFind(e.target.value)} />
            <div className="flex flex-col gap-1.5">
              {people.map((e) => <Checkbox key={e.id} checked={panel.includes(e.id)} onChange={(v) => setPanel(v ? [...panel, e.id] : panel.filter((x) => x !== e.id))} label={`${e.name} (${e.code})`} />)}
            </div>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

function OfferDialog({ app, name, expected, onClose, onDone }: { app: AppRow; name: string; expected: number | null; onClose: () => void; onDone: () => void }) {
  const L = useLookups();
  const [f, setF] = useState({ offeredCtc: String(app.offeredCtc ?? expected ?? ""), joiningDate: app.joiningDate ?? "", designationId: "", note: "" });
  const save = useMutation({
    mutationFn: () => api.post(`/admin/recruitment/applications/${app.id}/offer`, { offeredCtc: Number(f.offeredCtc), joiningDate: f.joiningDate, designationId: f.designationId || null, note: f.note }),
    onSuccess: () => (toast.success("Offer recorded"), onDone()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Offer for ${name}`} description="Recorded here for the team. Send the offer letter itself from the letter generator once they're hired, or by your usual route." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!(Number(f.offeredCtc) > 0) || !f.joiningDate} loading={save.isPending} onClick={() => save.mutate()}>Save offer</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Annual CTC (₹)" hint={Number(f.offeredCtc) > 0 ? inr(Number(f.offeredCtc)) : undefined}><Input type="number" min={0} value={f.offeredCtc} onChange={(e) => setF({ ...f, offeredCtc: e.target.value })} /></Field>
        <Field label="Joining date"><Input type="date" value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} /></Field>
        <Field label="Designation (if not the job's)" span><Select value={f.designationId} onChange={(e) => setF({ ...f, designationId: e.target.value })}><option value="">As on the job</option>{L.data?.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Note (optional)" span><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

function HireDialog({ app, name, onClose, onDone }: { app: AppRow; name: string; onClose: () => void; onDone: () => void }) {
  const nav = useNavigate();
  const code = useQuery({ queryKey: ["next-employee-code"], queryFn: () => api.get<{ code: string }>("/admin/recruitment/next-employee-code") });
  const [f, setF] = useState({ employeeCode: "", workEmail: "", dateOfJoining: app.joiningDate ?? todayIST(), sendOnboardingInvite: true });
  const employeeCode = f.employeeCode || code.data?.code || "";
  const save = useMutation({
    mutationFn: () => api.post<{ employeeId: string; jobClosed: boolean }>(`/admin/recruitment/applications/${app.id}/hire`, { ...f, employeeCode }),
    onSuccess: (r) => {
      toast.success(`${name} is hired${f.sendOnboardingInvite ? " and has their onboarding invite" : ""}${r.jobClosed ? ". All openings are filled, so the job is closed." : ""}`);
      onDone();
      nav(`/employees/${r.employeeId}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Hire ${name}`} description="Creates their employee record from the job and offer (department, designation, manager, CTC). Their resume becomes their first document." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!employeeCode || !f.workEmail.includes("@")} loading={save.isPending} onClick={() => save.mutate()}>Hire</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Employee ID"><Input value={employeeCode} onChange={(e) => setF({ ...f, employeeCode: e.target.value })} /></Field>
        <Field label="Joining date"><Input type="date" value={f.dateOfJoining} onChange={(e) => setF({ ...f, dateOfJoining: e.target.value })} /></Field>
        <Field label="Work email" span hint="Their company mailbox. Use their personal email if they won't have one."><Input type="email" value={f.workEmail} onChange={(e) => setF({ ...f, workEmail: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={f.sendOnboardingInvite} onChange={(v) => setF({ ...f, sendOnboardingInvite: v })} label="Email them the onboarding invite now (to their personal email)" /></div>
      </div>
    </Dialog>
  );
}
