import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fmtDate, inr, todayIST } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { KV, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { LOAN_TONE, METHOD_LABEL, monthLabel, type LoanDetail } from "./types";

type Mode = null | "approve" | "reject" | "payout" | "repay" | "writeoff";

/** One loan: balances, the schedule month by month, and what HR can do next. */
export function LoanDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["loans", "detail", id], queryFn: () => api.get<LoanDetail>(`/admin/payroll/loans/${id}`) });
  const [mode, setMode] = useState<Mode>(null);
  const [f, setF] = useState({ amount: "", months: "", interestPct: "", startMonth: "", note: "", paidOn: todayIST(), method: "bank_transfer", reference: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["loans"] });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => api.post(`/admin/payroll/loans/${id}/${path}`, body),
    onSuccess: (_r, v) => {
      toast.success({ decision: "Decision saved", disburse: "Payout recorded", repayment: "Repayment recorded", "write-off": "Written off", pause: "Schedule updated", cancel: "Cancelled" }[v.path] ?? "Saved");
      setMode(null);
      refresh();
    },
  });
  const d = q.data;
  if (!d) return <Dialog open onOpenChange={(v) => !v && onClose()} title="Loan">{q.isLoading ? <Loading /> : null}</Dialog>;
  const l = d.loan;
  const edit = can("payroll", "edit");
  const approve = can("payroll", "approve");
  const start = (m: Mode) => {
    setF({ ...f, amount: m === "repay" ? "" : String(l.amount), months: String(l.months), interestPct: String(l.interestPct), startMonth: l.startMonth < d.firstOpenMonth ? d.firstOpenMonth : l.startMonth, note: "", reference: "" });
    setMode(m);
  };
  const progress = l.payable ? Math.min(100, Math.round((l.recovered / l.payable) * 100)) : 0;

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      width={720}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {l.typeLabel} {l.code} <Tag tone={LOAN_TONE[l.status]}>{l.statusLabel}</Tag>
        </span>
      }
      description={`${d.employee.name} · ${d.employee.code}${l.reason ? ` · ${l.reason}` : ""}`}
      footer={
        mode ? undefined : <div className="flex w-full flex-wrap justify-end gap-2">
          {l.status === "requested" && approve ? (
            <>
              <Button onClick={() => start("reject")}>Reject</Button>
              <Button variant="primary" onClick={() => start("approve")}>
                Approve
              </Button>
            </>
          ) : null}
          {l.status === "approved" && edit ? (
            <>
              <Button onClick={() => act.mutate({ path: "cancel", body: {} })}>Cancel</Button>
              <Button variant="primary" onClick={() => start("payout")}>
                Record payout
              </Button>
            </>
          ) : null}
          {l.status === "active" ? (
            <>
              {approve ? <Button onClick={() => start("writeoff")}>Write off</Button> : null}
              {edit ? (
                <Button variant="primary" onClick={() => start("repay")}>
                  Record repayment
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {d.warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KV label="Amount">{inr(l.amount)}</KV>
          <KV label="Monthly">{inr(l.emi)}</KV>
          <KV label="Interest">{l.interestPct ? `${l.interestPct}% a year` : "Interest-free"}</KV>
          <KV label="Recovery">{`${monthLabel(l.startMonth)} to ${monthLabel(l.endMonth)}`}</KV>
          {l.paidOn ? <KV label="Paid out">{`${fmtDate(l.paidOn)} · ${METHOD_LABEL[l.paidMethod ?? ""] ?? l.paidMethod}${l.paidReference ? ` · ${l.paidReference}` : ""}`}</KV> : null}
          {l.decisionNote ? <KV label="Note">{l.decisionNote}</KV> : null}
        </div>
        {["active", "closed", "written_off"].includes(l.status) ? (
          <div>
            <div className="mb-1 flex justify-between text-[12.5px]">
              <span>
                Recovered {inr(l.recovered)} of {inr(l.payable)}
                {l.pending ? <span className="text-muted"> · {inr(l.pending)} in payroll not yet locked</span> : null}
              </span>
              <span className="font-semibold">{inr(l.outstanding)} left</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--tint-1)]">
              <div className="h-full rounded-full bg-[var(--ok-fg)]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}

        {mode === "approve" || mode === "reject" || mode === "payout" || mode === "repay" || mode === "writeoff" ? (
          <div className="card !gap-3 !p-3" style={{ background: "var(--tint-1)" }}>
            {mode === "approve" ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Amount (₹)"><Input type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
                <Field label="Months"><Input type="number" min={1} max={120} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field>
                <Field label="Interest % a year"><Input type="number" min={0} max={36} step={0.25} value={f.interestPct} onChange={(e) => setF({ ...f, interestPct: e.target.value })} /></Field>
                <Field label="First recovery"><Input type="month" min={d.firstOpenMonth} value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value })} /></Field>
              </div>
            ) : null}
            {mode === "payout" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Paid on"><Input type="date" max={todayIST()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
                <Field label="How">
                  <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
                    {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="Reference (UTR or cheque no.)"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
              </div>
            ) : null}
            {mode === "repay" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Amount (₹)" hint={`Up to ${inr(Math.max(0, l.outstanding - l.pending))}`}><Input type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
                <Field label="Paid on"><Input type="date" max={todayIST()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
                <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Paid back in cash" /></Field>
              </div>
            ) : null}
            {mode === "reject" || mode === "writeoff" || mode === "approve" ? (
              <Field label={mode === "approve" ? "Note (optional)" : mode === "reject" ? "Reason (the employee sees this)" : `Why ${inr(l.outstanding)} won't be recovered`}>
                <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
              </Field>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setMode(null)}>Back</Button>
              <Button
                variant="primary"
                loading={act.isPending}
                onClick={() =>
                  act.mutate(
                    mode === "approve"
                      ? { path: "decision", body: { decision: "approved", amount: Number(f.amount), months: Number(f.months), interestPct: Number(f.interestPct), startMonth: f.startMonth, note: f.note || null } }
                      : mode === "reject"
                        ? { path: "decision", body: { decision: "rejected", note: f.note } }
                        : mode === "payout"
                          ? { path: "disburse", body: { paidOn: f.paidOn, method: f.method, reference: f.reference || null } }
                          : mode === "repay"
                            ? { path: "repayment", body: { amount: Number(f.amount), paidOn: f.paidOn, note: f.note || null } }
                            : { path: "write-off", body: { note: f.note } },
                  )
                }
              >
                {{ approve: "Confirm approval", reject: "Confirm rejection", payout: "Save payout", repay: "Save repayment", writeoff: "Confirm write-off" }[mode]}
              </Button>
            </div>
          </div>
        ) : null}

        <div>
          <div className="card-title mb-1 text-[14px]">Schedule</div>
          <div className="scroll-thin max-h-[260px] overflow-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Month</th>
                  <th className="text-right">Instalment</th>
                  {l.interestPct ? <th className="text-right">Interest</th> : null}
                  <th className="text-right">Balance after</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.schedule.map((s) => {
                  const canPause = edit && l.status === "active" && !s.recovered && s.month >= d.firstOpenMonth;
                  return (
                    <tr key={s.month}>
                      <td>{s.n}</td>
                      <td>{monthLabel(s.month)}</td>
                      <td className="num text-right">{inr(s.emi)}</td>
                      {l.interestPct ? <td className="num text-right">{inr(s.interest)}</td> : null}
                      <td className="num text-right">{inr(s.balance)}</td>
                      <td>{s.recovered ? <Tag tone={s.recovered.locked ? "ok" : "warn"}>{s.recovered.locked ? "Recovered" : "In payroll"}</Tag> : <span className="text-muted">Upcoming</span>}</td>
                      <td className="text-right">{canPause ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: "pause", body: { month: s.month, paused: true } })}>Skip month</Button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {l.skipMonths.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-muted">Skipped:</span>
              {l.skipMonths.map((m) => (
                <span key={m} className="inline-flex items-center gap-1">
                  <Tag tone="neutral">{monthLabel(m)}</Tag>
                  {edit && m >= d.firstOpenMonth ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: "pause", body: { month: m, paused: false } })}>Undo</Button> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {d.repayments.length ? (
          <div>
            <div className="card-title mb-1 text-[14px]">Paid outside payroll</div>
            {d.repayments.map((r) => (
              <div key={r.id} className="flex justify-between border-b border-[var(--color-divider)] py-1.5 text-[13px]">
                <span>
                  {fmtDate(r.paidOn)} · {r.source === "fnf" ? "Full and final settlement" : (r.note ?? "Repayment")}
                </span>
                <span className="num">{inr(r.amount)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
