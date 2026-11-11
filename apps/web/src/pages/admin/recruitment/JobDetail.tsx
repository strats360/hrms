import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, FileText, Pencil, Plus, Star } from "lucide-react";
import { CLOSED_STAGES, daysSince, EMPLOYMENT_TYPE_LABELS, PIPELINE, SOURCE_LABEL, STAGE_LABEL, type Source, type Stage } from "@hrms/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, Loading, PageHeader } from "@/components/ui/page";
import { AddCandidateDialog, ctcRange, JobDialog, JobStatusTag, lakh, StageTag, type Job } from "@/components/recruitment/shared";
import { whenShort } from "./CandidateDetail";

interface App {
  id: string;
  stage: Stage;
  stageChangedAt: string;
  createdAt: string;
  rejectReason: string | null;
  offeredCtc: number | null;
  joiningDate: string | null;
  candidate: { id: string; name: string; email: string; phone: string | null; currentCompany: string | null; currentTitle: string | null; experienceYears: number | null; expectedCtc: number | null; noticeDays: number | null; source: Source; hasResume: boolean };
  feedback: { submitted: number; avgRating: number | null; nextInterview: string | null } | null;
}

function CandidateCard({ a, onOpen }: { a: App; onOpen: () => void }) {
  const c = a.candidate;
  const days = daysSince(a.stageChangedAt);
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:border-[var(--color-accent)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13.5px] font-medium">{c.name}</span>
        {c.hasResume ? <FileText size={14} className="text-muted flex-none" aria-label="Has resume" /> : null}
      </div>
      <div className="text-muted text-[12px]">{[c.currentTitle, c.currentCompany].filter(Boolean).join(" at ") || SOURCE_LABEL[c.source]}</div>
      <div className="text-muted flex flex-wrap gap-x-3 text-[12px]">
        {c.experienceYears != null ? <span>{c.experienceYears} yrs</span> : null}
        {c.expectedCtc != null ? <span>expects ₹{lakh(c.expectedCtc)}</span> : null}
        {c.noticeDays != null ? <span>{c.noticeDays}d notice</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        {a.feedback?.nextInterview ? <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {whenShort(a.feedback.nextInterview)}</span> : null}
        {a.feedback?.avgRating != null ? <span className="inline-flex items-center gap-1"><Star size={12} /> {a.feedback.avgRating} from {a.feedback.submitted}</span> : null}
        {a.stage === "offer" && a.offeredCtc ? <span>offer ₹{lakh(a.offeredCtc)}</span> : null}
        <span className={days > 7 ? "text-[var(--warn-fg,var(--muted))]" : "text-muted"}>{days === 0 ? "today" : `${days}d in stage`}</span>
      </div>
    </button>
  );
}

export default function JobDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["recruitment", "job", id], queryFn: () => api.get<{ job: Job; canEdit: boolean; applications: App[] }>(`/admin/recruitment/jobs/${id}`) });
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { job: j, applications, canEdit } = q.data;
  const closed = applications.filter((a) => CLOSED_STAGES.includes(a.stage));
  const open = (a: App) => nav(`/recruitment/candidates/${a.candidate.id}?application=${a.id}`);
  return (
    <>
      <Link to="/recruitment" className="inline-flex items-center gap-1 self-start text-[13px] no-underline">
        <ChevronLeft size={15} /> All jobs
      </Link>
      <PageHeader
        title={j.title}
        sub={[j.code, j.department, j.location ?? j.branch, EMPLOYMENT_TYPE_LABELS[j.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS], j.hiringManager ? `hiring manager ${j.hiringManager}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <JobStatusTag s={j.status} />
            {canEdit && j.status !== "closed" ? <Button onClick={() => setAdding(true)}><Plus size={15} /> Add candidate</Button> : null}
            {q.data && canEdit ? <Button onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button> : null}
          </>
        }
      />
      <div className="text-muted flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        <span>{j.hired} of {j.openings} filled</span>
        {ctcRange(j) ? <span>Budget {ctcRange(j)}</span> : null}
        {j.minExperience != null || j.maxExperience != null ? <span>{j.minExperience ?? 0}{j.maxExperience != null ? ` to ${j.maxExperience}` : "+"} years</span> : null}
        <span>{j.published && j.status === "open" ? "On the careers page" : "Not on the careers page"}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PIPELINE.map((s) => {
          const list = applications.filter((a) => a.stage === s);
          return (
            <div key={s} className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] bg-[var(--tint-1)] p-2.5" aria-label={`${STAGE_LABEL[s]} column`}>
              <div className="flex items-center justify-between px-1">
                <span className="text-[13px] font-medium">{STAGE_LABEL[s]}</span>
                <span className="text-muted num text-[12.5px]">{list.length}</span>
              </div>
              {list.map((a) => <CandidateCard key={a.id} a={a} onOpen={() => open(a)} />)}
              {!list.length ? <div className="text-muted px-1 pb-2 text-[12px]">Nobody here</div> : null}
            </div>
          );
        })}
      </div>
      {closed.length ? (
        <Card className="!gap-2">
          <CardHeader title={`Hired and closed (${closed.length})`} actions={<Button size="sm" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide" : "Show"}</Button>} />
          {showClosed
            ? closed.map((a) => (
                <button key={a.id} type="button" onClick={() => open(a)} className="flex items-center justify-between gap-2 border-b border-[var(--color-divider)] py-2 text-left last:border-b-0">
                  <span className="text-[13.5px]">{a.candidate.name}<span className="text-muted ml-2 text-[12px]">{a.rejectReason ?? ""}</span></span>
                  <StageTag s={a.stage} />
                </button>
              ))
            : null}
        </Card>
      ) : null}
      {j.description ? (
        <Card className="!gap-2">
          <CardHeader title="Description" />
          <div className="whitespace-pre-line text-[13.5px]">{j.description}</div>
        </Card>
      ) : null}
      {editing ? <JobDialog job={j} onClose={() => setEditing(false)} /> : null}
      {adding ? <AddCandidateDialog jobId={j.id} onClose={() => setAdding(false)} /> : null}
    </>
  );
}
