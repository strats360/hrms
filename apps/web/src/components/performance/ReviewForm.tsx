import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { goalProblem, MAX_GOALS, RATING_LABEL, RATINGS, ratingLabel, weightedScore } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import type { Goal, ReviewDetail } from "./types";

/** Five buttons, 1 to 5, as a radio group. */
export function RatingInput({ value, onChange, label, disabled }: { value: number | null | undefined; onChange: (v: number) => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
        {RATINGS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n}: ${RATING_LABEL[n]}`}
            title={RATING_LABEL[n]}
            disabled={disabled}
            onClick={() => onChange(n)}
            className="h-8 w-9 border-r border-[var(--color-border)] text-[13px] last:border-r-0 disabled:cursor-not-allowed"
            style={{ background: value === n ? "var(--color-accent)" : "transparent", color: value === n ? "white" : "var(--color-text)", fontWeight: value === n ? 600 : 400 }}
          >
            {n}
          </button>
        ))}
      </div>
      <span className="text-muted text-[12.5px]">{value ? RATING_LABEL[value] : "Not rated"}</span>
    </div>
  );
}

/** Read-only rating with its label. */
export const RatingTag = ({ value, who }: { value: number | null | undefined; who?: string }) =>
  value ? (
    <span className="text-[12.5px]">
      {who ? <span className="text-muted">{who}: </span> : null}
      <b>{value}</b> <span className="text-muted">{RATING_LABEL[Math.round(value)]}</span>
    </span>
  ) : null;

interface GoalDraft {
  id?: string;
  key: string;
  title: string;
  description: string;
  weight: number;
}
const toDraft = (g: Goal): GoalDraft => ({ id: g.id, key: g.id, title: g.title, description: g.description ?? "", weight: g.weight });

/** Add, edit and weight goals. Saves the whole list. */
export function GoalEditor({ goals, endpoint, onSaved, onCancel }: { goals: Goal[]; endpoint: string; onSaved: (r: ReviewDetail) => void; onCancel?: () => void }) {
  const [list, setList] = useState<GoalDraft[]>(() => (goals.length ? goals.map(toDraft) : [{ key: crypto.randomUUID(), title: "", description: "", weight: 100 }]));
  const sum = list.reduce((a, g) => a + (Number(g.weight) || 0), 0);
  const problem = goalProblem(list);
  const save = useMutation({
    mutationFn: () => api.put<ReviewDetail>(endpoint, { goals: list.map(({ id, title, description, weight }) => ({ id, title, description, weight: Number(weight) || 0 })) }),
    onSuccess: (r) => (toast.success("Goals saved"), onSaved(r)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (i: number, patch: Partial<GoalDraft>) => setList(list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <Card className="!gap-3">
      <CardHeader title="Goals for this period" sub="What you set out to do, and how much each one counts. Weights add up to 100%." />
      {list.map((g, i) => (
        <div key={g.key} className="grid gap-2 border-b border-[var(--color-divider)] pb-3 sm:grid-cols-[1fr_110px_auto]">
          <div className="flex flex-col gap-2">
            <Input aria-label={`Goal ${i + 1}`} placeholder={`Goal ${i + 1}, e.g. Launch the mobile app`} value={g.title} onChange={(e) => set(i, { title: e.target.value })} maxLength={200} />
            <Textarea aria-label={`Goal ${i + 1} details`} rows={2} placeholder="How you'll know it's done (optional)" value={g.description} onChange={(e) => set(i, { description: e.target.value })} />
          </div>
          <Field label="Weight %">
            <Input type="number" min={1} max={100} value={g.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })} aria-label={`Goal ${i + 1} weight`} />
          </Field>
          <div className="flex items-start sm:pt-6">
            <Button icon variant="ghost" aria-label={`Remove goal ${i + 1}`} disabled={list.length === 1} onClick={() => setList(list.filter((_, j) => j !== i))}>
              <Trash2 size={15} />
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" disabled={list.length >= MAX_GOALS} onClick={() => setList([...list, { key: crypto.randomUUID(), title: "", description: "", weight: Math.max(0, 100 - sum) }])}>
          <Plus size={14} /> Add goal
        </Button>
        <span className={`text-[12.5px] ${sum === 100 ? "text-muted" : "text-[var(--bad)]"}`}>Total {sum}%</span>
      </div>
      {problem ? <div className="text-muted text-[12.5px]">{problem}</div> : null}
      <div className="flex justify-end gap-2">
        {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
        <Button variant="primary" loading={save.isPending} disabled={!!problem} onClick={() => save.mutate()}>Save goals</Button>
      </div>
    </Card>
  );
}

/**
 * Rate each goal and competency and write the summary. `by` is whose form this is;
 * the other side's ratings show alongside when they're visible.
 */
export function AssessmentForm({ review, by, endpoint, onSaved }: { review: ReviewDetail; by: "self" | "manager"; endpoint: string; onSaved: (r: ReviewDetail) => void }) {
  const part = by === "self" ? review.self : review.managerPart;
  const init = () => ({
    goals: Object.fromEntries(review.goals.map((g) => [g.id, { rating: (by === "self" ? g.selfRating : g.managerRating) ?? null, comment: (by === "self" ? g.selfComment : g.managerComment) ?? "" }])),
    competencies: Object.fromEntries(review.cycle.competencies.map((k) => [k, part.competencies?.[k] ?? null])) as Record<string, number | null>,
    summary: part.summary ?? "",
    strengths: part.strengths ?? "",
    improvements: part.improvements ?? "",
  });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [review.id, review.goals.map((g) => g.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const score = useMemo(() => weightedScore(review.goals.map((g) => ({ weight: g.weight, [by === "self" ? "selfRating" : "managerRating"]: f.goals[g.id]?.rating })), by), [f, review.goals, by]);
  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api.put<ReviewDetail>(endpoint, {
        goals: review.goals.map((g) => ({ id: g.id, rating: f.goals[g.id]?.rating ?? null, comment: f.goals[g.id]?.comment ?? "" })),
        competencies: f.competencies,
        summary: f.summary,
        ...(by === "manager" ? { strengths: f.strengths, improvements: f.improvements } : {}),
        submit,
      }),
    onSuccess: (r, submit) => (toast.success(submit ? (by === "self" ? "Self review submitted. Your manager reviews it next." : "Review submitted to HR") : "Saved as draft"), onSaved(r)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setGoal = (id: string, patch: Partial<{ rating: number | null; comment: string }>) => setF({ ...f, goals: { ...f.goals, [id]: { ...f.goals[id]!, ...patch } } });

  return (
    <Card className="!gap-4">
      <CardHeader
        title={by === "self" ? "Your self review" : `Your review of ${review.employee.name ?? "them"}`}
        sub={`Rate each goal from 1 (${RATING_LABEL[1]!.toLowerCase()}) to 5 (${RATING_LABEL[5]!.toLowerCase()}).`}
        actions={score != null ? <Tag tone="accent">Score {score} · {ratingLabel(score)}</Tag> : null}
      />
      {review.goals.map((g, i) => (
        <div key={g.id} className="flex flex-col gap-2 border-b border-[var(--color-divider)] pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{i + 1}. {g.title}</div>
              {g.description ? <div className="text-muted whitespace-pre-line text-[12.5px]">{g.description}</div> : null}
            </div>
            <span className="text-muted text-[12px]">{g.weight}%</span>
          </div>
          {by === "manager" && g.selfRating ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--tint-1)] px-3 py-2">
              <RatingTag value={g.selfRating} who="Their rating" />
              {g.selfComment ? <div className="text-muted whitespace-pre-line text-[12.5px]">{g.selfComment}</div> : null}
            </div>
          ) : null}
          <RatingInput label={`Rating for ${g.title}`} value={f.goals[g.id]?.rating} onChange={(v) => setGoal(g.id, { rating: v })} />
          <Textarea aria-label={`Comment on ${g.title}`} rows={2} placeholder={by === "self" ? "What you did and how it went" : "What you saw"} value={f.goals[g.id]?.comment ?? ""} onChange={(e) => setGoal(g.id, { comment: e.target.value })} />
        </div>
      ))}
      {review.cycle.competencies.length ? (
        <div className="flex flex-col gap-2.5">
          <div className="text-[14px] font-medium">Competencies</div>
          {review.cycle.competencies.map((k) => (
            <div key={k} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13.5px]">
                {k}
                {by === "manager" && review.self.competencies?.[k] ? <span className="text-muted ml-2 text-[12px]">they said {review.self.competencies[k]}</span> : null}
              </span>
              <RatingInput label={k} value={f.competencies[k]} onChange={(v) => setF({ ...f, competencies: { ...f.competencies, [k]: v } })} />
            </div>
          ))}
        </div>
      ) : null}
      {by === "manager" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Strengths"><Textarea rows={3} value={f.strengths} onChange={(e) => setF({ ...f, strengths: e.target.value })} /></Field>
          <Field label="To work on"><Textarea rows={3} value={f.improvements} onChange={(e) => setF({ ...f, improvements: e.target.value })} /></Field>
        </div>
      ) : null}
      {by === "manager" && review.self.summary ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--tint-1)] p-3 text-[13px]">
          <div className="text-muted text-[12px]">Their summary</div>
          <div className="whitespace-pre-line">{review.self.summary}</div>
        </div>
      ) : null}
      <Field label={by === "self" ? "Overall, how did the period go? (optional)" : "Overall comment"}>
        <Textarea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      </Field>
      {by === "self" ? <Notice tone="sel">Your manager sees this once you submit. You can save a draft and come back.</Notice> : <Notice tone="sel">HR checks ratings across teams before reviews are shared. {review.employee.name ?? "They"} sees your ratings and comments after that.</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>Save draft</Button>
        <Button variant="primary" loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Submit</Button>
      </div>
    </Card>
  );
}

/** The finished review: both sides' ratings and the manager's comments. */
export function ReviewSummary({ review, showSelf = true }: { review: ReviewDetail; showSelf?: boolean }) {
  const m = review.managerPart;
  return (
    <Card className="!gap-4">
      <CardHeader
        title={review.finalRating != null ? `Final rating: ${review.finalRating} · ${review.finalLabel}` : "Ratings"}
        sub={[review.manager ? `Reviewed by ${review.manager.name}` : null, review.managerScore != null ? `manager's score ${review.managerScore}` : null, review.selfScore != null && showSelf ? `self score ${review.selfScore}` : null].filter(Boolean).join(" · ")}
      />
      {review.goals.map((g, i) => (
        <div key={g.id} className="flex flex-col gap-1.5 border-b border-[var(--color-divider)] pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[14px] font-medium">{i + 1}. {g.title}</div>
            <span className="text-muted text-[12px]">{g.weight}%</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {showSelf ? <RatingTag value={g.selfRating} who="Self" /> : null}
            <RatingTag value={g.managerRating} who="Manager" />
          </div>
          {g.managerComment ? <div className="whitespace-pre-line text-[13px]">{g.managerComment}</div> : null}
        </div>
      ))}
      {review.cycle.competencies.length ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[14px] font-medium">Competencies</div>
          {review.cycle.competencies.map((k) => (
            <div key={k} className="flex flex-wrap justify-between gap-2 text-[13px]">
              <span>{k}</span>
              <span className="flex gap-4">
                {showSelf ? <RatingTag value={review.self.competencies?.[k]} who="Self" /> : null}
                <RatingTag value={m.competencies?.[k]} who="Manager" />
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        {m.strengths ? <div><div className="text-muted text-[12px]">Strengths</div><div className="whitespace-pre-line">{m.strengths}</div></div> : null}
        {m.improvements ? <div><div className="text-muted text-[12px]">To work on</div><div className="whitespace-pre-line">{m.improvements}</div></div> : null}
      </div>
      {m.summary ? <div className="text-[13px]"><div className="text-muted text-[12px]">Manager's comment</div><div className="whitespace-pre-line">{m.summary}</div></div> : null}
      {review.employeeComment ? <div className="text-[13px]"><div className="text-muted text-[12px]">{review.employee.name ? `${review.employee.name}'s` : "Your"} comment</div><div className="whitespace-pre-line">{review.employeeComment}</div></div> : null}
    </Card>
  );
}
