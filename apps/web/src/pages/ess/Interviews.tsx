import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, FileText } from "lucide-react";
import { INTERVIEW_MODE_LABEL, RATING_LABEL, RATINGS, RECOMMENDATION_LABEL, RECOMMENDATIONS, type Recommendation } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { RatingInput } from "@/components/performance/ReviewForm";
import { openFile, whenShort } from "@/pages/admin/recruitment/CandidateDetail";

interface Item { id: string; round: string; scheduledAt: string; durationMinutes: number; mode: keyof typeof INTERVIEW_MODE_LABEL; location: string | null; status: string; candidate: string; job: string; feedbackDone: boolean }
interface Detail {
  id: string;
  round: string;
  scheduledAt: string;
  durationMinutes: number;
  mode: keyof typeof INTERVIEW_MODE_LABEL;
  location: string | null;
  status: string;
  job: { title: string; code: string; description: string };
  candidate: { name: string; currentCompany: string | null; currentTitle: string | null; experienceYears: number | null; noticeDays: number | null; hasResume: boolean };
  feedback: { rating: number | null; recommendation: Recommendation | null; notes: string | null; submittedAt: string | null };
}

export default function EssInterviews() {
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["interviews", "mine"], queryFn: () => api.get<Item[]>("/ess/interviews") });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const list = q.data ?? [];
  const id = params.get("id") ?? list.find((i) => !i.feedbackDone && i.status !== "cancelled")?.id ?? list[0]?.id;
  return (
    <>
      <div>
        <h1 className="!mb-1 text-[26px]">Interviews</h1>
        <div className="text-muted text-[13.5px]">Interviews you're on the panel for. Add your feedback once each one is done.</div>
      </div>
      {!list.length ? (
        <Card><Empty title="No interviews" sub="When you're added to an interview panel, it shows up here." /></Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card padded={false} className="!gap-0 overflow-hidden">
            {list.map((i) => (
              <button key={i.id} type="button" onClick={() => setParams({ id: i.id })} className="flex w-full items-center gap-3 border-b border-[var(--color-divider)] px-4 py-3 text-left last:border-b-0" style={{ background: i.id === id ? "var(--sel-bg)" : undefined }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{i.candidate}</div>
                  <div className="text-muted truncate text-[12px]">{i.round} · {i.job}</div>
                  <div className="text-muted text-[12px]">{whenShort(i.scheduledAt)}</div>
                  <div className="mt-1">{i.status === "cancelled" ? <Tag tone="outline">Cancelled</Tag> : i.feedbackDone ? <Tag tone="ok">Feedback in</Tag> : new Date(i.scheduledAt) > new Date() ? <Tag tone="accent">Upcoming</Tag> : <Tag tone="warn">Feedback needed</Tag>}</div>
                </div>
                <ChevronRight size={16} className="text-muted flex-none" />
              </button>
            ))}
          </Card>
          {id ? <InterviewDetail id={id} /> : null}
        </div>
      )}
    </>
  );
}

function InterviewDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["interviews", "mine", id], queryFn: () => api.get<Detail>(`/ess/interviews/${id}`) });
  const [f, setF] = useState<{ rating: number | null; recommendation: Recommendation | null; notes: string }>({ rating: null, recommendation: null, notes: "" });
  const save = useMutation({
    mutationFn: () => api.post(`/ess/interviews/${id}/feedback`, f),
    onSuccess: () => (toast.success("Feedback sent. Thanks."), qc.invalidateQueries({ queryKey: ["interviews", "mine"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const c = d.candidate;
  const upcoming = new Date(d.scheduledAt).getTime() > Date.now() + 15 * 60_000;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="!gap-2">
        <CardHeader title={`${c.name}: ${d.round}`} sub={`${d.job.title} · ${whenShort(d.scheduledAt)} · ${d.durationMinutes} min · ${INTERVIEW_MODE_LABEL[d.mode]}`} actions={c.hasResume ? <Button size="sm" onClick={() => openFile(`/ess/interviews/${id}/resume`)}><FileText size={14} /> Resume</Button> : null} />
        {d.location ? <div className="text-[13.5px]">{/^https?:\/\//.test(d.location) ? <a href={d.location} target="_blank" rel="noreferrer">{d.location}</a> : d.location}</div> : null}
        <div className="text-muted text-[13px]">{[c.currentTitle, c.currentCompany].filter(Boolean).join(" at ")}{c.experienceYears != null ? ` · ${c.experienceYears} years` : ""}{c.noticeDays != null ? ` · ${c.noticeDays} days notice` : ""}</div>
        {d.job.description ? <details className="text-[13px]"><summary className="text-muted cursor-pointer">About the role</summary><div className="mt-1 whitespace-pre-line">{d.job.description}</div></details> : null}
      </Card>
      {d.status === "cancelled" ? <Notice tone="sel">This interview was cancelled.</Notice> : d.feedback.submittedAt ? (
        <Card className="!gap-2">
          <CardHeader title="Your feedback" />
          <div className="text-[13.5px]"><b>{d.feedback.rating}</b> {RATING_LABEL[d.feedback.rating!]} · {RECOMMENDATION_LABEL[d.feedback.recommendation!]}</div>
          <div className="whitespace-pre-line text-[13.5px]">{d.feedback.notes}</div>
        </Card>
      ) : upcoming ? (
        <Notice tone="sel">Add your feedback here after the interview.</Notice>
      ) : (
        <Card className="!gap-3">
          <CardHeader title="Your feedback" sub="Other interviewers' feedback isn't shown to you, so you can give your own view." />
          <Field label="Overall rating"><RatingInput label="Overall rating" value={f.rating} onChange={(v) => setF({ ...f, rating: v })} /></Field>
          <Field label="Should we hire them?">
            <div role="radiogroup" aria-label="Recommendation" className="flex flex-wrap gap-2">
              {RECOMMENDATIONS.map((r) => (
                <Button key={r} size="sm" variant={f.recommendation === r ? "primary" : "secondary"} role="radio" aria-checked={f.recommendation === r} onClick={() => setF({ ...f, recommendation: r })}>{RECOMMENDATION_LABEL[r]}</Button>
              ))}
            </div>
          </Field>
          <Field label="Notes" hint="Strengths, concerns and anything the next round should dig into"><Textarea rows={5} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button variant="primary" disabled={!f.rating || !f.recommendation || f.notes.trim().length < 10} loading={save.isPending} onClick={() => save.mutate()}>Send feedback</Button></div>
        </Card>
      )}
    </div>
  );
}
