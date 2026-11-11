import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Pencil } from "lucide-react";
import { fmtDate, REVIEW_STAGE_LABEL, type CycleStatus, type ReviewStage } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { AssessmentForm, GoalEditor, ReviewSummary } from "@/components/performance/ReviewForm";
import type { ReviewDetail } from "@/components/performance/types";

interface Item {
  id: string;
  cycle: string;
  cycleStatus: CycleStatus;
  periodStart: string;
  periodEnd: string;
  selfDue: string;
  stage: ReviewStage;
  finalRating: number | null;
  finalLabel: string;
}
export const STAGE_TONE: Record<ReviewStage, Tone> = { self: "warn", manager: "neutral", calibration: "neutral", shared: "accent", acknowledged: "ok" };
const myStage = (s: ReviewStage) => (s === "self" ? "Your turn" : s === "manager" ? "With your manager" : s === "calibration" ? "With HR" : s === "shared" ? "Ready to read" : "Done");

export default function EssReviews() {
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["reviews", "mine"], queryFn: () => api.get<Item[]>("/ess/reviews") });
  const list = q.data ?? [];
  const id = params.get("id") ?? list.find((r) => r.cycleStatus === "active")?.id ?? list[0]?.id ?? null;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <div>
        <h1 className="!mb-1 text-[26px]">Reviews</h1>
        <div className="text-muted text-[13.5px]">Set your goals, rate how the period went, and read your manager's review.</div>
      </div>
      {!list.length ? (
        <Card>
          <Empty title="No reviews yet" sub="When HR starts a review cycle, yours appears here." />
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card padded={false} className="!gap-0 overflow-hidden">
            {list.map((r) => (
              <button key={r.id} type="button" onClick={() => setParams({ id: r.id })} className="flex w-full items-center gap-3 border-b border-[var(--color-divider)] px-4 py-3 text-left last:border-b-0" style={{ background: r.id === id ? "var(--sel-bg)" : undefined }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{r.cycle}</div>
                  <div className="text-muted text-[12px]">{fmtDate(r.periodStart)} to {fmtDate(r.periodEnd)}</div>
                  <div className="mt-1">{r.finalRating != null ? <Tag tone="ok">{r.finalRating} · {r.finalLabel}</Tag> : <Tag tone={STAGE_TONE[r.stage]}>{myStage(r.stage)}</Tag>}</div>
                </div>
                <ChevronRight size={16} className="text-muted flex-none" />
              </button>
            ))}
          </Card>
          {id ? <MyReview id={id} /> : null}
        </div>
      )}
    </>
  );
}

function MyReview({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reviews", "mine", id], queryFn: () => api.get<ReviewDetail>(`/ess/reviews/${id}`) });
  const [editGoals, setEditGoals] = useState(false);
  const [comment, setComment] = useState("");
  useEffect(() => setEditGoals(false), [id]);
  const saved = (r: ReviewDetail) => {
    qc.setQueryData(["reviews", "mine", id], r);
    qc.invalidateQueries({ queryKey: ["reviews", "mine"], exact: true });
    setEditGoals(false);
  };
  const ack = useMutation({
    mutationFn: () => api.post(`/ess/reviews/${id}/acknowledge`, { comment }),
    onSuccess: () => (toast.success("Thanks. Your review is acknowledged."), qc.invalidateQueries({ queryKey: ["reviews", "mine"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const r = q.data;
  const open = r.cycle.status === "active";
  const canEdit = open && r.stage === "self";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="!gap-2">
        <CardHeader
          title={r.cycle.name}
          sub={`${fmtDate(r.cycle.periodStart)} to ${fmtDate(r.cycle.periodEnd)}${r.manager ? ` · reviewed by ${r.manager.name}` : ""}`}
          actions={<Tag tone={STAGE_TONE[r.stage]}>{REVIEW_STAGE_LABEL[r.stage]}</Tag>}
        />
        {canEdit ? <Notice tone="warn">Submit your self review by {fmtDate(r.cycle.selfDue)}.</Notice> : null}
        {r.stage === "manager" ? <div className="text-muted text-[13px]">You submitted on {r.selfSubmittedAt ? fmtDate(r.selfSubmittedAt.slice(0, 10)) : "—"}. Your manager is reviewing it now.</div> : null}
        {r.stage === "calibration" ? <div className="text-muted text-[13px]">Your manager has finished. HR shares the review with you once ratings are checked across teams.</div> : null}
        {r.cycle.status === "closed" && r.stage !== "shared" && r.stage !== "acknowledged" ? <div className="text-muted text-[13px]">This cycle closed before your review was finished.</div> : null}
      </Card>

      {canEdit && (editGoals || !r.goals.length) ? (
        <GoalEditor goals={r.goals} endpoint={`/ess/reviews/${id}/goals`} onSaved={saved} onCancel={r.goals.length ? () => setEditGoals(false) : undefined} />
      ) : null}
      {canEdit && r.goals.length && !editGoals ? (
        <>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditGoals(true)}>
              <Pencil size={14} /> Edit goals
            </Button>
          </div>
          <AssessmentForm review={r} by="self" endpoint={`/ess/reviews/${id}/self`} onSaved={saved} />
        </>
      ) : null}

      {r.stage === "shared" || r.stage === "acknowledged" ? <ReviewSummary review={r} /> : null}
      {!canEdit && r.stage !== "shared" && r.stage !== "acknowledged" && r.goals.length ? <ReviewSummary review={{ ...r, finalRating: null }} /> : null}

      {r.stage === "shared" ? (
        <Card className="!gap-3">
          <CardHeader title="Acknowledge your review" sub="This says you've read it, not that you agree. Add a comment if you'd like to respond." />
          <Field label="Your comment (optional)">
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" loading={ack.isPending} onClick={() => ack.mutate()}>Acknowledge</Button>
          </div>
        </Card>
      ) : null}
      {r.acknowledgedAt ? <div className="text-muted text-[12.5px]">You acknowledged this on {fmtDate(r.acknowledgedAt.slice(0, 10))}.</div> : null}
    </div>
  );
}
