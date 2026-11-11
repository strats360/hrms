import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { fmtDate, inr, loanSchedule } from "@hrms/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Empty } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { LOAN_TONE, monthLabel, type LoanRow } from "@/components/loans/types";

export interface MyLoansData {
  rows: LoanRow[];
  policy: { requests: boolean; advanceMax: number; advanceMaxMonths: number; loanMax: number; loanMaxMonths: number; interestPct: number };
}

/** The employee's own advances and loans, and a way to ask for one. */
export function MyLoans({ data }: { data: MyLoansData }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const withdraw = useMutation({ mutationFn: (id: string) => api.post(`/ess/loans/${id}/cancel`), onSuccess: () => (toast.success("Request withdrawn"), qc.invalidateQueries({ queryKey: ["ess", "loans"] })) });
  const active = data.rows.filter((l) => l.status === "active");
  return (
    <>
      {active.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((l) => (
            <Card key={l.id} className="!gap-1.5">
              <div className="flex items-center justify-between">
                <div className="card-kicker">
                  {l.typeLabel} · {l.code}
                </div>
                <Tag tone="ok">Recovering</Tag>
              </div>
              <div className="num text-[24px] font-medium">{inr(l.outstanding)} <span className="text-muted text-[13px] font-normal">left</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--tint-1)]">
                <div className="h-full rounded-full bg-[var(--ok-fg)]" style={{ width: `${l.payable ? Math.round((l.recovered / l.payable) * 100) : 0}%` }} />
              </div>
              <div className="text-muted text-[12.5px]">
                {inr(l.emi)} a month from your salary{l.nextMonth ? `, next in ${monthLabel(l.nextMonth)}` : ""} · last in {monthLabel(l.endMonth)}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      <Card className="!gap-2">
        <CardHeader
          title="Loans and advances"
          sub="Instalments come off your salary each month and show on your payslip."
          actions={
            data.policy.requests ? (
              <Button variant="primary" onClick={() => setAsking(true)}>
                <Plus size={15} /> Ask for one
              </Button>
            ) : null
          }
        />
        {data.rows.length ? (
          <div className="flex flex-col divide-y divide-[var(--color-divider)]">
            {data.rows.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13.5px]">
                <div className="min-w-0">
                  <div className="font-medium">
                    {l.typeLabel} {l.code} · {inr(l.amount)}
                  </div>
                  <div className="text-muted text-[12px]">
                    {l.months} month{l.months === 1 ? "" : "s"}
                    {l.interestPct ? ` at ${l.interestPct}%` : ", interest-free"}
                    {l.paidOn ? ` · paid out ${fmtDate(l.paidOn)}` : ` · asked ${fmtDate(l.createdAt.slice(0, 10))}`}
                    {l.status === "rejected" && l.decisionNote ? ` · ${l.decisionNote}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Tag tone={LOAN_TONE[l.status]}>{l.statusLabel}</Tag>
                  {l.status === "requested" ? (
                    <Button size="sm" variant="ghost" loading={withdraw.isPending && withdraw.variables === l.id} onClick={() => withdraw.mutate(l.id)}>
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Nothing here yet" sub={data.policy.requests ? "Need money ahead of payday? Ask for a salary advance." : "Ask HR if you need a salary advance or a loan."} />
        )}
      </Card>
      {asking ? <AskDialog policy={data.policy} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

function AskDialog({ policy, onClose }: { policy: MyLoansData["policy"]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ type: "advance" as "advance" | "loan", amount: "", months: "1", reason: "" });
  const max = f.type === "advance" ? policy.advanceMax : policy.loanMax;
  const maxMonths = f.type === "advance" ? policy.advanceMaxMonths : policy.loanMaxMonths;
  const amount = Number(f.amount);
  const months = Number(f.months);
  const rate = f.type === "loan" ? policy.interestPct : 0;
  const plan = amount > 0 && months > 0 ? loanSchedule(amount, rate, months, "2000-01") : [];
  const ask = useMutation({
    mutationFn: () => api.post("/ess/loans", { type: f.type, amount, months, reason: f.reason.trim() }),
    onSuccess: () => {
      toast.success("Request sent to HR");
      qc.invalidateQueries({ queryKey: ["ess", "loans"] });
      onClose();
    },
  });
  const over = amount > max || months > maxMonths;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Ask for an advance or loan"
      description="HR reviews it. Once it's paid out, the instalments come off your salary."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!amount || !months || over || f.reason.trim().length < 3} loading={ask.isPending} onClick={() => ask.mutate()}>
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as "advance" | "loan", months: "1" })}>
              <option value="advance">Salary advance</option>
              <option value="loan">Loan</option>
            </Select>
          </Field>
          <Field label="Amount (₹)" hint={`Up to ${inr(max)}`} error={amount > max ? "More than the limit" : null}>
            <Input type="number" min={1} max={max} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Repay over (months)" hint={`Up to ${maxMonths}`} error={months > maxMonths ? "Too long" : null}>
            <Input type="number" min={1} max={maxMonths} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} />
          </Field>
        </div>
        <Field label="What it's for">
          <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Family medical expense" />
        </Field>
        {plan.length && !over ? (
          <div className="text-[13px]">
            About <b>{inr(plan[0]!.emi)}</b> a month for {plan.length} month{plan.length === 1 ? "" : "s"}
            {rate ? `, at ${rate}% interest (${inr(plan.reduce((s, x) => s + x.interest, 0))} in total)` : ", interest-free"}.
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
