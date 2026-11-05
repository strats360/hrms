import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { inr } from "@hrms/shared";
import { api } from "@/lib/api";
import type { PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Loading, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { monthLabel } from "@/components/payroll/Payslip";
import { RUN_STATUS_LABEL } from "@/components/payroll/PayrollCard";
import { DONE_UPTO, MAX_STEP, START_STEP, STEPS } from "@/components/payroll/wizard/shared";
import { StepApprove, StepAttendance, StepCalculate, StepInputs, StepMonth, StepPayout, StepReview } from "@/components/payroll/wizard/Steps";
import { RUN_TONE } from "./Runs";

export default function RunWizard() {
  const { runId } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payroll", "run", runId], queryFn: () => api.get<PayrollRun>(`/admin/payroll/runs/${runId}`) });
  const run = q.data;
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    if (run && step === null) setStep(START_STEP[run.status]!);
  }, [run, step]);

  const calculate = useMutation({
    mutationFn: () => api.post<PayrollRun>(`/admin/payroll/runs/${runId}/calculate`),
    onSuccess: (r) => {
      toast.success(`Calculated ${r.totals?.employees ?? 0} payslips · net ${inr(r.totals?.net ?? 0)}`);
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setStep((s) => (s !== null && s < 4 ? 4 : s));
    },
  });

  if (q.isLoading || (run && step === null)) return <Loading />;
  if (q.error || !run) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const current = step!;
  const max = MAX_STEP[run.status]!;
  const doneUpto = DONE_UPTO[run.status]!;
  const label = STEPS[current - 1]!;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link to="/payroll" className="inline-flex items-center gap-1 text-[13px] no-underline">
          <ChevronLeft size={14} /> All payroll runs
        </Link>
        <PageHeader title={`${monthLabel(run.month)} payroll`} sub={`${run.totals?.employees ?? "No"} employees · ${RUN_STATUS_LABEL[run.status]}`} actions={<Tag tone={RUN_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Tag>} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="!gap-0.5 !p-3 lg:sticky lg:top-[90px]">
          <div className="card-kicker px-2 pb-2">{monthLabel(run.month)} run</div>
          <nav aria-label="Payroll steps" className="flex flex-col gap-0.5">
            {STEPS.map((s, i) => {
              const n = i + 1;
              const done = n <= doneUpto;
              const active = n === current;
              const reachable = n <= max;
              return (
                <button
                  key={s}
                  disabled={!reachable}
                  aria-current={active ? "step" : undefined}
                  onClick={() => setStep(n)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] border-0 px-2.5 py-2 text-left text-[13.5px] hover:bg-[var(--tint-1)] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: active ? "var(--sel-bg)" : "transparent", color: active ? "var(--sel-fg)" : "var(--color-text)", fontWeight: active ? 600 : 400 }}
                >
                  <span className="grid h-6 w-6 flex-none place-items-center rounded-full text-[11.5px] font-semibold" style={{ background: done ? "var(--ok-bg)" : active ? "var(--color-accent)" : "var(--tint-2)", color: done ? "var(--ok-fg)" : active ? "var(--color-bg)" : "var(--muted)" }}>
                    {done ? <Check size={13} /> : n}
                  </span>
                  {s}
                </button>
              );
            })}
          </nav>
        </Card>
        <Card className="!gap-4">
          <div>
            <div className="card-kicker">Step {current} of 7</div>
            <div className="text-[22px] font-medium tracking-tight">{label}</div>
          </div>
          {current === 1 ? <StepMonth run={run} /> : null}
          {current === 2 ? <StepInputs run={run} /> : null}
          {current === 3 ? <StepAttendance run={run} onCalculate={() => calculate.mutate()} calculating={calculate.isPending} /> : null}
          {current === 4 ? <StepCalculate run={run} onCalculate={() => calculate.mutate()} calculating={calculate.isPending} /> : null}
          {current === 5 ? <StepReview run={run} /> : null}
          {current === 6 ? <StepApprove run={run} /> : null}
          {current === 7 ? <StepPayout run={run} /> : null}
          <div className="mt-2 flex justify-between gap-2 border-t border-[var(--color-divider)] pt-3">
            <Button disabled={current <= 1} onClick={() => setStep(current - 1)}>
              <ChevronLeft size={16} /> Back
            </Button>
            {current < 7 ? (
              <Button variant="primary" disabled={current + 1 > max} onClick={() => setStep(current + 1)} title={current + 1 > max ? (run.status === "draft" ? "Run the calculation first" : "Approve the payroll first") : undefined}>
                Continue <ChevronRight size={16} />
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
