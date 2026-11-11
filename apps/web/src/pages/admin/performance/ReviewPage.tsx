import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { fmtDate, REVIEW_STAGE_LABEL } from "@hrms/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { ChevronLeft } from "lucide-react";
import { AssessmentForm, GoalEditor, ReviewSummary } from "@/components/performance/ReviewForm";
import type { ReviewDetail } from "@/components/performance/types";
import { STAGE_TONE } from "@/pages/ess/Reviews";
import { CalibrateDialog } from "./CycleDetail";

export default function ReviewPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const key = ["performance", "review", id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<ReviewDetail>(`/admin/performance/reviews/${id}`) });
  const [editGoals, setEditGoals] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const r = q.data;
  const saved = (x: ReviewDetail) => {
    qc.setQueryData(key, { ...x, canCalibrate: r.canCalibrate });
    qc.invalidateQueries({ queryKey: ["performance", "cycle", r.cycle.id] });
    setEditGoals(false);
  };
  const open = r.cycle.status === "active";
  const managerTurn = open && r.stage === "manager";
  return (
    <>
      <Link to={`/performance/${r.cycle.id}`} className="inline-flex items-center gap-1 self-start text-[13px] no-underline">
        <ChevronLeft size={15} /> {r.cycle.name}
      </Link>
      <PageHeader
        title={r.employee.name ?? "Review"}
        sub={[r.employee.designation, r.employee.department, r.manager ? `reviewer ${r.manager.name}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <Tag tone={STAGE_TONE[r.stage]}>{REVIEW_STAGE_LABEL[r.stage]}</Tag>
            {r.canCalibrate && open && r.stage === "calibration" ? <Button variant="primary" onClick={() => setCalibrating(true)}>Set final rating</Button> : null}
          </>
        }
      />
      {r.stage === "self" ? <Notice tone="sel">Waiting for {r.employee.name}'s self review, due {fmtDate(r.cycle.selfDue)}. You can set or adjust their goals meanwhile.</Notice> : null}
      {managerTurn ? <Notice tone="warn">Your review is due by {fmtDate(r.cycle.managerDue)}.</Notice> : null}
      {r.calibrationNote ? <Notice tone="sel">HR note on the final rating: {r.calibrationNote}</Notice> : null}

      <div className="flex max-w-[900px] flex-col gap-4">
        {open && (r.stage === "self" || r.stage === "manager") && (editGoals || !r.goals.length) ? (
          <GoalEditor goals={r.goals} endpoint={`/admin/performance/reviews/${id}/goals`} onSaved={saved} onCancel={r.goals.length ? () => setEditGoals(false) : undefined} />
        ) : null}
        {open && (r.stage === "self" || r.stage === "manager") && r.goals.length && !editGoals ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditGoals(true)}>
              <Pencil size={14} /> Edit goals
            </Button>
          </div>
        ) : null}
        {managerTurn && r.goals.length && !editGoals ? <AssessmentForm review={r} by="manager" endpoint={`/admin/performance/reviews/${id}/manager`} onSaved={saved} /> : null}
        {!managerTurn && r.stage !== "self" ? <ReviewSummary review={r} /> : null}
        {r.stage === "self" && r.goals.length && !editGoals ? (
          <Card className="!gap-2">
            <CardHeader title="Goals" />
            {r.goals.map((g, i) => (
              <div key={g.id} className="flex justify-between gap-2 text-[13.5px]">
                <span>{i + 1}. {g.title}</span>
                <span className="text-muted">{g.weight}%</span>
              </div>
            ))}
          </Card>
        ) : null}
        {r.acknowledgedAt ? <div className="text-muted text-[12.5px]">{r.employee.name} acknowledged this on {fmtDate(r.acknowledgedAt.slice(0, 10))}.</div> : null}
      </div>
      {calibrating ? <CalibrateDialog row={{ id: r.id, name: r.employee.name ?? "", managerScore: r.managerScore, finalRating: r.finalRating }} onClose={() => setCalibrating(false)} onDone={() => qc.invalidateQueries({ queryKey: ["performance"] })} /> : null}
    </>
  );
}
