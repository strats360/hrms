import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Download, Lock, Send, Unlock, Wallet } from "lucide-react";
import { fmtDate, inr, todayIST } from "@hrms/shared";
import { api, ApiError, download, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { PayrollInputs, PayrollItem, PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Loading, Notice } from "@/components/ui/page";
import { StatCard } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { Spinner } from "@/components/ui/spinner";
import { monthLabel } from "@/components/payroll/Payslip";
import { PayslipDialog } from "@/components/payroll/PayslipDialog";
import { isLocked, Money, names, pctChange, Row, statutoryOutflow } from "./shared";

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["payroll"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

function useInputs(run: PayrollRun) {
  return useQuery({ queryKey: ["payroll", "inputs", run.id], queryFn: () => api.get<PayrollInputs>(`/admin/payroll/runs/${run.id}/inputs`) });
}

// ---------------------------------------------------------------------------
// 1 Payroll month
// ---------------------------------------------------------------------------
export function StepMonth({ run }: { run: PayrollRun }) {
  const { can } = useSession();
  const invalidate = useInvalidate();
  const [payDate, setPayDate] = useState(run.payDate ?? "");
  useEffect(() => setPayDate(run.payDate ?? ""), [run.payDate]);
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/payroll/runs/${run.id}`, { payDate }),
    onSuccess: () => {
      toast.success("Pay date saved");
      invalidate();
    },
  });
  const editable = !isLocked(run) && can("payroll", "edit");
  const prev = run.previous;
  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))" }}>
        <Field label="Payroll month">
          <Input value={monthLabel(run.month)} readOnly />
        </Field>
        <Field label="Pay period">
          <Input value={`${fmtDate(run.periodStart, false)} – ${fmtDate(run.periodEnd)}`} readOnly />
        </Field>
        <Field label="Payment date" hint={editable ? "Defaults to the last working day" : undefined}>
          <div className="flex gap-2">
            <Input type="date" value={payDate} min={run.periodStart} onChange={(e) => setPayDate(e.target.value)} disabled={!editable} />
            {editable && payDate && payDate !== run.payDate ? (
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            ) : null}
          </div>
        </Field>
        <Field label="Branches">
          <Input value="All branches" readOnly />
        </Field>
        <Field label="Employee categories">
          <Input value="Full-time, part-time, contract, interns" readOnly />
        </Field>
        <Field label="Exits this month">
          <Input value="Included, prorated to last working day" readOnly />
        </Field>
      </div>
      <div className="text-[13px]" style={{ color: "var(--muted-2)" }}>
        {prev ? (
          <>
            <span className="font-medium" style={{ color: "var(--color-text)" }}>{monthLabel(prev.month)}</span>
            {prev.status === "paid" || prev.status === "approved"
              ? ` was locked${prev.approvedAt ? ` on ${fmtDate(prev.approvedAt.slice(0, 10), false)}` : ""} · ${prev.totals?.employees ?? 0} employees · ${inr(prev.totals?.net ?? 0)} net · `
              : ` is still open (${prev.status}) · `}
            <Link to={`/payroll/run/${prev.id}`}>view</Link>
          </>
        ) : (
          "This is the first payroll run on this system. TDS for the year will be annualised until opening balances are added."
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2 Fetch inputs
// ---------------------------------------------------------------------------
export function StepInputs({ run }: { run: PayrollRun }) {
  const q = useInputs(run);
  if (q.isLoading) return <Loading label="Fetching salary structures and inputs…" />;
  if (!q.data) return <Notice tone="bad">{errorMessage(q.error)}</Notice>;
  const d = q.data;
  return (
    <div className="flex flex-col gap-2">
      <Row title="Salary structures" sub={`${d.employees} employees fetched · ${d.structuresRevised} revised this month`} tag="Ready" />
      <Row title="New joiners" sub={d.joiners.length ? `${d.joiners.length} · prorated from joining date · ${names(d.joiners)}` : "No one joined this month"} tag="Ready" />
      <Row
        title="Exits"
        sub={d.exits.length ? `${d.exits.length} · paid to last working day · ${d.exits.map((x) => `${x.name}${x.date ? ` (LWD ${fmtDate(x.date, false)})` : ""}`).slice(0, 4).join(", ")}` : "No one leaves this month"}
        tag={d.exits.length ? "Review" : "Ready"}
        tone={d.exits.length ? "warn" : "ok"}
      >
        {d.exits.length ? <div className="text-muted text-[12px]">Full and final settlement is handled separately.</div> : null}
      </Row>
      <Row title="One-time earnings and deductions" sub={d.adjustments.count ? `${d.adjustments.count} item(s) · net ${inr(d.adjustments.net)}` : "None added yet. Add incentives, arrears or recoveries in Review & approve."} tag="Ready" />
      <Row
        title="Bank details"
        sub={d.missingBank.length ? `${d.missingBank.length} missing · ${names(d.missingBank)}. They'll be left out of the bank file, not out of payroll.` : "Every employee has a bank account on file"}
        tag={d.missingBank.length ? "Review" : "Ready"}
        tone={d.missingBank.length ? "warn" : "ok"}
      />
      <Row
        title="PAN"
        sub={d.missingPan.length ? `${d.missingPan.length} missing · ${names(d.missingPan)}. Without PAN, TDS should be at least 20%.` : "Every employee has a PAN"}
        tag={d.missingPan.length ? "Review" : "Ready"}
        tone={d.missingPan.length ? "warn" : "ok"}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 Attendance & LOP
// ---------------------------------------------------------------------------
export function StepAttendance({ run, onCalculate, calculating }: { run: PayrollRun; onCalculate: () => void; calculating: boolean }) {
  const { can } = useSession();
  const inputs = useInputs(run);
  const items = useQuery({
    queryKey: ["payroll", "items", run.id, "lop"],
    queryFn: () => api.get<PayrollItem[]>(`/admin/payroll/runs/${run.id}/items${qs({ filter: "lop" })}`),
    enabled: run.status !== "draft",
  });
  const days = Number(run.periodEnd.slice(8));
  const t = run.totals;
  const d = inputs.data;
  const editable = run.status === "calculated" && can("payroll", "edit");
  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <StatCard label="Calendar days" value={days} />
        <StatCard label="Employees" value={d?.employees ?? "—"} />
        <StatCard label="Employees with LOP" value={t ? t.withLop : "—"} meta={t ? `${t.lopDays} LOP days total` : "After calculation"} />
        <StatCard label="Pending corrections" value={d?.pendingCorrections ?? "—"} meta={d?.pendingCorrections ? <Tag tone="warn">Blocks approval</Tag> : "None"} />
        <StatCard label="Pending leave" value={d?.pendingLeave ?? "—"} meta="Unpaid leave counts once approved" />
      </div>
      {d?.pendingCorrections ? (
        <Notice tone="warn">
          {d.pendingCorrections} attendance correction(s) for this month are still pending. Approval is blocked until they're resolved. <Link to="/attendance/corrections">Review corrections</Link>
        </Notice>
      ) : null}
      <div className="text-muted text-[12.5px]">LOP comes from approved attendance: absent days count as 1, half days as 0.5, and approved unpaid leave as its days. Days not marked yet are treated as present.</div>
      {run.status === "draft" ? (
        <Notice tone="sel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>LOP is worked out when the payroll is calculated.</span>
            {can("payroll", "edit") ? (
              <Button variant="primary" loading={calculating} onClick={onCalculate}>
                Calculate now
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : items.isLoading ? (
        <Loading />
      ) : (
        <div className="scroll-thin min-w-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Paid days</th>
                <th>LOP (attendance)</th>
                <th>LOP used</th>
                {editable ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {(items.data ?? []).map((i) => (
                <LopRow key={i.id} item={i} run={run} editable={editable} />
              ))}
              {items.data?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted text-center">
                    No one has LOP this month
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function LopRow({ item, run, editable }: { item: PayrollItem; run: PayrollRun; editable: boolean }) {
  const invalidate = useInvalidate();
  const [v, setV] = useState<string>(String(item.lopOverride ?? item.lopDays));
  useEffect(() => setV(String(item.lopOverride ?? item.lopDays)), [item.lopOverride, item.lopDays]);
  const save = useMutation({
    mutationFn: (lopOverride: number | null) => api.patch(`/admin/payroll/runs/${run.id}/items/${item.employeeId}`, { lopOverride }),
    onSuccess: () => {
      toast.success(`LOP updated for ${item.snapshot.name}. Payroll recalculated.`);
      invalidate();
    },
  });
  const num = Number(v);
  const valid = v !== "" && !Number.isNaN(num) && num >= 0 && num <= item.daysInMonth && num * 2 === Math.round(num * 2);
  return (
    <tr>
      <td>
        <div className="font-medium">{item.snapshot.name}</div>
        <div className="text-muted text-[12px]">{item.snapshot.code}</div>
      </td>
      <td className="num">
        {item.paidDays} / {item.daysInMonth}
      </td>
      <td className="num">{item.lopDays}</td>
      <td>
        {editable ? (
          <Input className="!w-20" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label={`LOP days for ${item.snapshot.name}`} invalid={!valid} />
        ) : (
          <span className="num">{item.lopOverride ?? item.lopDays}</span>
        )}
        {item.lopOverride !== null ? <Tag tone="accent" className="ml-1.5">Overridden</Tag> : null}
      </td>
      {editable ? (
        <td>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" disabled={!valid || num === Number(item.lopOverride ?? item.lopDays)} loading={save.isPending && save.variables !== null} onClick={() => save.mutate(num)}>
              Save
            </Button>
            {item.lopOverride !== null ? (
              <Button size="sm" variant="ghost" loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}>
                Use attendance
              </Button>
            ) : null}
          </div>
        </td>
      ) : null}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 4 Calculate
// ---------------------------------------------------------------------------
const CALC_STEPS = ["Fetch salary structures", "Apply attendance and LOP", "Earnings and proration", "PF, EPS and EDLI", "ESI", "Professional tax and LWF", "Income tax (TDS) with year-to-date", "Net pay and employer cost"];

export function StepCalculate({ run, onCalculate, calculating }: { run: PayrollRun; onCalculate: () => void; calculating: boolean }) {
  const { can } = useSession();
  const nav = useNavigate();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!calculating) return setTick(0);
    const t = setInterval(() => setTick((x) => Math.min(CALC_STEPS.length - 1, x + 1)), 280);
    return () => clearInterval(t);
  }, [calculating]);
  const exceptions = useQuery({
    queryKey: ["payroll", "items", run.id, "exceptions"],
    queryFn: () => api.get<PayrollItem[]>(`/admin/payroll/runs/${run.id}/items${qs({ filter: "exceptions" })}`),
    enabled: run.status !== "draft",
  });
  const t = run.totals;
  return (
    <>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {CALC_STEPS.map((s, i) => {
          const done = (run.status !== "draft" && !calculating) || (calculating && i < tick);
          const running = calculating && i === tick;
          return (
            <div key={s} className="flex items-center gap-2.5 text-[13.5px]">
              <span className="grid h-5 w-5 flex-none place-items-center rounded-full" style={{ background: done ? "var(--ok-bg)" : "var(--tint-2)", color: done ? "var(--ok-fg)" : "var(--muted)" }}>
                {done ? <Check size={12} /> : running ? <Spinner size={12} /> : null}
              </span>
              {s}
            </div>
          );
        })}
      </div>
      {can("payroll", "edit") && !isLocked(run) ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={calculating} onClick={onCalculate}>
            {run.status === "draft" ? "Run calculation" : "Recalculate"}
          </Button>
          {run.calculatedAt ? <span className="text-muted text-[12.5px]">Last calculated {new Date(run.calculatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}{run.calculatedByName ? ` by ${run.calculatedByName}` : ""}</span> : null}
        </div>
      ) : null}
      {t && run.status !== "draft" ? (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))" }}>
            <Money label="Gross earnings" value={t.gross} />
            <Money label="Total deductions" value={t.deductions} />
            <Money label="Net payable" value={t.net} accent meta={`${t.employees} employees`} />
            <Money label="Employer contributions" value={t.employerCost} />
            <Money label="TDS" value={t.tds} />
            <Money label="Cost to company" value={t.ctc} />
          </div>
          {exceptions.data?.length ? (
            <div className="text-muted text-[13px]">
              {exceptions.data.length} employee(s) have warnings or holds.{" "}
              <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] underline" style={{ color: "var(--color-accent)" }} onClick={() => nav(`/payroll/review?run=${run.id}&filter=exceptions`)}>
                Review exceptions
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 5 Review
// ---------------------------------------------------------------------------
export function StepReview({ run }: { run: PayrollRun }) {
  const nav = useNavigate();
  const [slip, setSlip] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["payroll", "items", run.id, "exceptions"],
    queryFn: () => api.get<PayrollItem[]>(`/admin/payroll/runs/${run.id}/items${qs({ filter: "exceptions" })}`),
    enabled: run.status !== "draft",
  });
  const t = run.totals;
  const p = run.previous?.totals;
  if (!t || run.status === "draft") return <Notice tone="sel">Calculate the payroll to review it.</Notice>;
  const rows: [string, number, number | undefined][] = [
    ["Employees", t.employees, p?.employees],
    ["Gross earnings", t.gross, p?.gross],
    ["Deductions", t.deductions, p?.deductions],
    ["Net pay", t.net, p?.net],
    ["TDS", t.tds, p?.tds],
    ["Cost to company", t.ctc, p?.ctc],
  ];
  return (
    <>
      <div className="scroll-thin min-w-0 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th />
              <th style={{ textAlign: "right" }}>{monthLabel(run.month)}</th>
              <th style={{ textAlign: "right" }}>{run.previous ? monthLabel(run.previous.month) : "Last month"}</th>
              <th style={{ textAlign: "right" }}>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, now, before]) => (
              <tr key={label}>
                <td className="font-medium">{label}</td>
                <td className="num" style={{ textAlign: "right" }}>{label === "Employees" ? now : inr(now)}</td>
                <td className="num text-muted" style={{ textAlign: "right" }}>{before === undefined ? "—" : label === "Employees" ? before : inr(before)}</td>
                <td className="num" style={{ textAlign: "right" }}>{pctChange(now, before)?.replace(" vs last month", "") ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-title text-[15px]">Exceptions</div>
      {q.isLoading ? (
        <Loading />
      ) : q.data?.length ? (
        <div className="flex flex-col gap-1.5">
          {q.data.slice(0, 10).map((i) => (
            <button key={i.id} onClick={() => setSlip(i.employeeId)} className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border-0 px-3 py-2 text-left text-[13px]" style={{ background: "var(--tint-1)", color: "var(--color-text)" }}>
              <span>
                <span className="font-medium">{i.snapshot.name}</span> <span className="text-muted">{i.snapshot.code}</span>
                <span className="text-muted block text-[12px]">{[i.onHold ? `On hold${i.holdReason ? `: ${i.holdReason}` : ""}` : null, ...i.warnings].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="num font-semibold">{inr(i.net)}</span>
            </button>
          ))}
          {q.data.length > 10 ? <div className="text-muted text-[12.5px]">and {q.data.length - 10} more</div> : null}
        </div>
      ) : (
        <div className="text-muted text-[13px]">No warnings. Everything looks consistent.</div>
      )}
      <div>
        <Button onClick={() => nav(`/payroll/review?run=${run.id}`)}>Open full register</Button>
      </div>
      <PayslipDialog runId={slip ? run.id : null} employeeId={slip} onClose={() => setSlip(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 6 Approve & lock
// ---------------------------------------------------------------------------
export function StepApprove({ run }: { run: PayrollRun }) {
  const { can } = useSession();
  const invalidate = useInvalidate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: () => api.post<PayrollRun>(`/admin/payroll/runs/${run.id}/approve`),
    meta: { silent: true },
    onSuccess: () => {
      toast.success(`${monthLabel(run.month)} payroll approved and locked`);
      setConfirmOpen(false);
      setError(null);
      invalidate();
    },
    onError: (e) => {
      setConfirmOpen(false);
      setError(e instanceof ApiError ? e.message : "Couldn't approve the payroll");
    },
  });
  const reopen = useMutation({
    mutationFn: () => api.post(`/admin/payroll/runs/${run.id}/reopen`, { reason: reason.trim() }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Payroll reopened. Recalculate after your changes, then approve again.");
      setReopenOpen(false);
      setReason("");
      invalidate();
    },
    onError: (e) => {
      setReopenOpen(false);
      setError(errorMessage(e));
    },
  });
  const inputs = useInputs(run);
  const pendingCorr = inputs.data?.pendingCorrections ?? 0;
  const t = run.totals;
  if (!t || run.status === "draft") return <Notice tone="sel">Calculate and review the payroll before approving it.</Notice>;
  const p = run.previous?.totals;
  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" }}>
        <Money label="Net payable" value={t.net} accent meta={`${t.employees} employees${t.onHold ? ` · ${t.onHold} on hold` : ""}`} />
        <Money label="Statutory outflow" value={statutoryOutflow(t)} meta="PF · ESI · PT · LWF · TDS incl. employer" />
        <Money label="Cost to company" value={t.ctc} meta={pctChange(t.ctc, p?.ctc) ?? "First month on this system"} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="font-medium">Approval chain</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone="ok">{run.calculatedByName ?? "Payroll admin"} · prepared</Tag>
          <span className="text-muted">→</span>
          {isLocked(run) ? <Tag tone="ok">{run.approvedByName ?? "Approver"} · approved & locked</Tag> : <Tag tone="warn">Approve & lock</Tag>}
        </div>
        <div className="text-muted text-[12.5px]">The person who calculated the payroll can't approve it, unless they're a super admin. Locking freezes attendance, salary structures and amounts for {monthLabel(run.month)}.</div>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {!isLocked(run) && pendingCorr > 0 && !error ? (
        <Notice tone="warn">
          {pendingCorr} attendance correction(s) for this month are still pending. Resolve them and recalculate before approving. <Link to="/attendance/corrections">Review corrections</Link>
        </Notice>
      ) : null}
      {isLocked(run) ? (
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="ok">
            Locked{run.approvedAt ? ` · ${new Date(run.approvedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}
            {run.approvedByName ? ` · ${run.approvedByName}` : ""}
          </Tag>
          {run.status === "approved" && can("payroll", "configure") ? (
            run.bankFileExportedAt ? (
              <span className="text-muted text-[12.5px]">Can't reopen: the bank file was already exported.</span>
            ) : (
              <Button variant="ghost" onClick={() => setReopenOpen(true)}>
                <Unlock size={15} /> Reopen
              </Button>
            )
          ) : null}
        </div>
      ) : can("payroll", "approve") ? (
        <div>
          <Button variant="primary" disabled={pendingCorr > 0} onClick={() => setConfirmOpen(true)}>
            <Lock size={16} /> Approve & lock {monthLabel(run.month).split(" ")[0]} payroll
          </Button>
        </div>
      ) : (
        <Notice tone="sel">A finance approver or super admin needs to approve this payroll.</Notice>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Approve and lock ${monthLabel(run.month)}?`}
        description="After locking, attendance, salary structures and amounts for this month can't change unless a super admin reopens it."
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>
              Approve & lock
            </Button>
          </>
        }
      >
        <div className="grid gap-2 text-[13.5px]">
          <div className="flex justify-between"><span>Employees</span><span className="num">{t.employees}</span></div>
          <div className="flex justify-between"><span>Net payable</span><span className="num font-semibold">{inr(t.net)}</span></div>
          <div className="flex justify-between"><span>Salaries on hold</span><span className="num">{t.onHold}</span></div>
        </div>
      </Dialog>
      <Dialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Reopen payroll"
        description="The run goes back to calculated, payslips are unpublished, and the reason is written to the audit log."
        footer={
          <>
            <Button onClick={() => setReopenOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={reason.trim().length < 5} loading={reopen.isPending} onClick={() => reopen.mutate()}>
              Reopen
            </Button>
          </>
        }
      >
        <Field label="Reason">
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: wrong LOP for two employees" maxLength={300} />
        </Field>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// 7 Payslips & bank file
// ---------------------------------------------------------------------------
export function StepPayout({ run }: { run: PayrollRun }) {
  const { can } = useSession();
  const invalidate = useInvalidate();
  const [paidOpen, setPaidOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(todayIST());
  const [reference, setReference] = useState("");
  const [exporting, setExporting] = useState(false);
  const locked = isLocked(run);
  const publish = useMutation({
    mutationFn: () => api.post<{ published: boolean; emailed: number; held: number }>(`/admin/payroll/runs/${run.id}/publish`),
    onSuccess: (r) => {
      toast.success(`Published. ${r.emailed} emailed${r.held ? `, ${r.held} held` : ""}.`);
      invalidate();
    },
  });
  const markPaid = useMutation({
    mutationFn: () => api.post(`/admin/payroll/runs/${run.id}/mark-paid`, { paidOn, reference: reference.trim() || null }),
    onSuccess: () => {
      toast.success(`${monthLabel(run.month)} payroll marked as paid`);
      setPaidOpen(false);
      invalidate();
    },
  });
  const exportBank = async () => {
    setExporting(true);
    try {
      await download(`/admin/payroll/runs/${run.id}/bank-file.csv`, `salary-${run.month}-bank.csv`);
      toast.success("Bank file downloaded");
      invalidate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  const t = run.totals;
  const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  return (
    <>
      {!locked ? <Notice tone="warn">Payroll must be approved and locked (step 6) before payslips and bank files can be generated.</Notice> : null}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
        <Card className="!gap-2" style={{ background: "var(--tint-1)" }}>
          <div className="card-title">Payslips</div>
          <div className="text-muted text-[13px]">{t?.employees ?? 0} payslips · published to self-service and emailed (held salaries aren't emailed)</div>
          {run.publishedAt ? <Tag tone="ok" className="self-start">Published {when(run.publishedAt)}</Tag> : null}
          <Button variant="primary" className="mt-auto self-start" disabled={!locked || !can("payroll", "approve")} loading={publish.isPending} onClick={() => publish.mutate()}>
            <Send size={15} /> {run.publishedAt ? "Publish again" : "Publish payslips"}
          </Button>
        </Card>
        <Card className="!gap-2" style={{ background: "var(--tint-1)" }}>
          <div className="card-title">Salary payment</div>
          {run.paymentBatch ? (
            <>
              <div className="text-muted text-[13px]">Paid through payment batch {run.paymentBatch.code}. Download the bank file and record the bank's result there.</div>
              <Link to={`/payments/batches/${run.paymentBatch.id}`} className="btn btn-primary mt-auto self-start">
                <Wallet size={15} /> Open {run.paymentBatch.code}
              </Link>
            </>
          ) : can("payments", "edit") ? (
            <>
              <div className="text-muted text-[13px]">
                {inr(t?.net ?? 0)} · builds a payment batch for approval, the bank's upload file, and tracks failed transfers. Held salaries and missing bank details are held back.
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Link to={locked && run.status === "approved" ? `/payments?generate=salary&run=${run.id}` : "#"} aria-disabled={!locked || run.status !== "approved"} className={`btn btn-primary self-start ${!locked || run.status !== "approved" ? "pointer-events-none opacity-45" : ""}`}>
                  <Wallet size={15} /> Create payment batch
                </Link>
                <Button disabled={!locked || !can("payroll", "export")} loading={exporting} onClick={exportBank}>
                  <Download size={15} /> Quick CSV
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-muted text-[13px]">
                CSV · {inr(t?.net ?? 0)} · held salaries and missing bank details are skipped, duplicate account and amount pairs are blocked
              </div>
              {run.bankFileExportedAt ? <Tag tone="ok" className="self-start">Exported {when(run.bankFileExportedAt)}</Tag> : null}
              <Button variant="primary" className="mt-auto self-start" disabled={!locked || !can("payroll", "export")} loading={exporting} onClick={exportBank}>
                <Download size={15} /> Export bank CSV
              </Button>
            </>
          )}
        </Card>
        <Card className="!gap-2" style={{ background: "var(--tint-1)" }}>
          <div className="card-title">Mark paid</div>
          <div className="text-muted text-[13px]">After the bank confirms the transfer, mark the payroll paid to close the cycle.</div>
          {run.status === "paid" ? (
            <Tag tone="ok" className="self-start">
              Paid {run.paidAt ? fmtDate(run.paidAt.slice(0, 10)) : ""}
              {run.paymentReference ? ` · ${run.paymentReference}` : ""}
            </Tag>
          ) : null}
          {run.paymentBatch && run.status !== "paid" ? <div className="text-muted text-[12px]">Marked paid automatically once the bank's result is recorded for every payment in {run.paymentBatch.code}.</div> : null}
          <Button variant="primary" className="mt-auto self-start" disabled={run.status !== "approved" || !run.bankFileExportedAt || !!run.paymentBatch || !can("payroll", "approve")} onClick={() => setPaidOpen(true)}>
            <Wallet size={15} /> {run.status === "paid" ? "Completed" : "Mark as paid"}
          </Button>
          {run.status === "approved" && !run.bankFileExportedAt ? <div className="text-muted text-[12px]">Export the bank file first.</div> : null}
        </Card>
      </div>
      <Dialog
        open={paidOpen}
        onOpenChange={setPaidOpen}
        title="Mark payroll as paid"
        footer={
          <>
            <Button onClick={() => setPaidOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!paidOn} loading={markPaid.isPending} onClick={() => markPaid.mutate()}>
              Mark as paid
            </Button>
          </>
        }
      >
        <Field label="Paid on">
          <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="Bank reference (optional)" hint="UTR or batch reference from the bank">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
        </Field>
      </Dialog>
    </>
  );
}
