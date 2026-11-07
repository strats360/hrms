import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { inr, todayIST } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import type { BatchPreview, BatchStatus, DebitAccount, Payment, PaymentStatus, PaymentsSummary, PaymentType } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";

const BATCH_TONE: Record<BatchStatus, Tone> = { draft: "neutral", approved: "accent", processing: "warn", completed: "ok", cancelled: "neutral" };
const BATCH_LABEL: Record<BatchStatus, string> = { draft: "Draft", approved: "Approved", processing: "With bank", completed: "Completed", cancelled: "Cancelled" };
export function BatchStatusTag({ status }: { status: BatchStatus }) {
  return <Tag tone={BATCH_TONE[status]}>{BATCH_LABEL[status]}</Tag>;
}
const PAY_TONE: Record<PaymentStatus, Tone> = { pending: "warn", paid: "ok", failed: "bad", held: "neutral", cancelled: "neutral" };
const PAY_LABEL: Record<PaymentStatus, string> = { pending: "Pending", paid: "Paid", failed: "Failed", held: "On hold", cancelled: "Cancelled" };
export function PaymentStatusTag({ status }: { status: PaymentStatus }) {
  return <Tag tone={PAY_TONE[status]}>{PAY_LABEL[status]}</Tag>;
}
export const TYPE_LABEL: Record<PaymentType, string> = { salary: "Salary", reimbursement: "Reimbursements", bonus: "Bonus", other: "Other" };

export const useAccounts = () => useQuery({ queryKey: ["payments", "accounts"], queryFn: () => api.get<DebitAccount[]>("/admin/payments/accounts") });
export const usePaymentsSummary = () => useQuery({ queryKey: ["payments", "summary"], queryFn: () => api.get<PaymentsSummary>("/admin/payments/summary") });

const FORMATS = [
  { value: "hdfc_enet", label: "HDFC ENet (CSV)" },
  { value: "icici_cib", label: "ICICI CIB bulk (TXT)" },
  { value: "generic_csv", label: "Generic CSV" },
];
export const FORMAT_OPTIONS = FORMATS;

/** Pasted lines: "STL-0042, 5000, Referral bonus" (comma or tab separated, header optional). */
function parseLines(text: string) {
  const out: { employeeCode: string; amount: number; description: string | null }[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l, i) => {
      const [code, amt, ...rest] = l.split(/\t|,/).map((x) => x.trim());
      const amount = Number((amt ?? "").replace(/[₹,\s]/g, ""));
      if (i === 0 && !Number.isFinite(amount)) return; // header
      if (!code || !Number.isFinite(amount) || amount <= 0) errors.push(`Line ${i + 1}: expected employee ID and amount`);
      else out.push({ employeeCode: code, amount, description: rest.join(", ") || null });
    });
  return { lines: out, errors };
}

/** Build a batch: pick the type and source, see the totals and checks, then create a draft. */
export function GenerateBatchDialog({ open, onClose, initialType = "salary", initialRunId }: { open: boolean; onClose: () => void; initialType?: PaymentType; initialRunId?: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const accounts = useAccounts();
  const summary = usePaymentsSummary();
  const active = useMemo(() => (accounts.data ?? []).filter((a) => a.active), [accounts.data]);
  const [type, setType] = useState<PaymentType>(initialType);
  const [runId, setRunId] = useState(initialRunId ?? "");
  const [bankAccountId, setBank] = useState("");
  const [fileFormat, setFormat] = useState("");
  const [paymentDate, setDate] = useState(todayIST());
  const [label, setLabel] = useState("");
  const [paste, setPaste] = useState("");
  const [fy, setFy] = useState(() => {
    const [y, m] = todayIST().split("-").map(Number) as [number, number];
    const s = (m >= 4 ? y : y - 1) - 1;
    return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  });
  const [percent, setPercent] = useState("8.33");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(initialType);
    setRunId(initialRunId ?? "");
    setError(null);
    setPaste("");
    setLabel("");
  }, [open, initialType, initialRunId]);
  useEffect(() => {
    if (!bankAccountId && active.length) setBank((active.find((a) => a.isDefault) ?? active[0])!.id);
  }, [active, bankAccountId]);
  useEffect(() => {
    if (type === "salary" && !runId && summary.data?.readySalary[0]) setRunId(summary.data.readySalary[0].runId);
  }, [type, runId, summary.data]);
  const account = active.find((a) => a.id === bankAccountId);
  const parsed = useMemo(() => parseLines(paste), [paste]);

  const body = useMemo(() => {
    const b: Record<string, unknown> = { type, bankAccountId, paymentDate, fileFormat: fileFormat || undefined, label: label.trim() || null };
    if (type === "salary") b.payrollRunId = runId;
    if (type === "bonus" && !paste.trim()) b.bonus = { fy, percent: Number(percent) };
    if (type === "other" || (type === "bonus" && paste.trim())) b.lines = parsed.lines;
    return b;
  }, [type, bankAccountId, paymentDate, fileFormat, label, runId, fy, percent, paste, parsed.lines]);
  const ready = !!bankAccountId && (type !== "salary" || !!runId) && (type !== "other" || parsed.lines.length > 0);
  const preview = useQuery({
    queryKey: ["payments", "preview", body],
    queryFn: () => api.post<BatchPreview>("/admin/payments/batches/preview", body),
    enabled: open && ready,
    retry: false,
  });

  const create = useMutation({
    meta: { silent: true },
    mutationFn: () => api.post<{ id: string; code: string; summary: BatchPreview["summary"] }>("/admin/payments/batches", body),
    onSuccess: (r) => {
      toast.success(`${r.code} created as a draft: ${r.summary.count} payments, ${inr(r.summary.amount)}. It needs approval before the bank file.`);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["claims"] });
      onClose();
      nav(`/payments/batches/${r.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const p = preview.data;
  const fyStart = Number(todayIST().slice(0, 4)) - (Number(todayIST().slice(5, 7)) >= 4 ? 0 : 1);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Generate payment batch"
      description="Creates a draft. Someone with payment approval rights approves it, then you download the bank file."
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready || !p || !p.summary.count || p.duplicates > 0} loading={create.isPending} onClick={() => create.mutate()}>
            Generate batch
          </Button>
        </>
      }
    >
      <Field label="Payment type">
        <Select value={type} onChange={(e) => setType(e.target.value as PaymentType)}>
          <option value="salary">Salary (locked payroll)</option>
          <option value="reimbursement">Reimbursements (approved, unpaid claims)</option>
          <option value="bonus">Bonus</option>
          <option value="other">Other employee payment</option>
        </Select>
      </Field>
      {type === "salary" ? (
        <Field label="Payroll month" hint={summary.data && !summary.data.readySalary.length ? "No locked payroll is waiting for payment" : undefined}>
          <Select value={runId} onChange={(e) => setRunId(e.target.value)}>
            {!summary.data?.readySalary.length ? <option value="">Nothing ready</option> : null}
            {summary.data?.readySalary.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.label} · {r.employees} employees · {inr(r.net)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {type === "bonus" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Statutory bonus for FY">
            <Select value={fy} onChange={(e) => setFy(e.target.value)} disabled={!!paste.trim()}>
              {[fyStart - 1, fyStart - 2, fyStart].map((s) => {
                const v = `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
                return (
                  <option key={v} value={v}>
                    FY {v}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label="Bonus rate (%)" hint="8.33% minimum, 20% maximum">
            <Input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ""))} disabled={!!paste.trim()} />
          </Field>
        </div>
      ) : null}
      {type === "other" || type === "bonus" ? (
        <Field label={type === "bonus" ? "Or paste amounts instead (optional)" : "Payments"} hint="One per line: employee ID, amount, description. Paste from a spreadsheet works too.">
          <Textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"STL-0042, 5000, Referral bonus\nSTL-0152, 7500, Relocation"} />
        </Field>
      ) : null}
      {parsed.errors.length && paste.trim() ? <Notice tone="warn">{parsed.errors.slice(0, 3).join(" · ")}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Debit account">
          <Select value={bankAccountId} onChange={(e) => setBank(e.target.value)}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName} ····{a.accountLast4} ({a.label})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payment date">
          <Input type="date" value={paymentDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Bank file format">
          <Select value={fileFormat || account?.fileFormat || "generic_csv"} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p?.label ?? "Optional"} maxLength={80} />
        </Field>
      </div>
      {preview.error ? <Notice tone="bad">{errorMessage(preview.error)}</Notice> : null}
      {p ? (
        <div className="flex flex-col gap-1 rounded-[var(--radius-md)] px-3.5 py-3 text-[13.5px]" style={{ background: "var(--tint-1)" }}>
          <Row label="Payments" value={<strong>{p.summary.count}</strong>} />
          <Row label="Total amount" value={<strong className="num">{inr(p.summary.amount)}</strong>} />
          <Row label="Duplicate check" value={<Tag tone={p.duplicates ? "bad" : "ok"}>{p.duplicates ? `${p.duplicates} duplicate${p.duplicates === 1 ? "" : "s"}` : "0 duplicates"}</Tag>} />
          <Row label="Bank details missing" value={<Tag tone={p.summary.missingBank ? "warn" : "ok"}>{p.summary.missingBank ? `${p.summary.missingBank} held · ${inr(p.summary.missingBankAmount)}` : "0"}</Tag>} />
          {type === "bonus" && p.skipped ? <Row label="Not eligible" value={`${p.skipped} employees`} /> : null}
          {account && account.balance !== null && p.summary.amount > Number(account.balance) ? <Row label="Account balance" value={<Tag tone="bad">{inr(account.balance)} is less than the batch</Tag>} /> : null}
        </div>
      ) : null}
      {p?.warnings.length ? (
        <Notice tone="warn">
          {p.warnings.slice(0, 4).map((w) => (
            <div key={w}>{w}</div>
          ))}
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export type PaymentAction = "paid" | "failed" | "held" | "pending" | "cancelled";
const ACTION_TITLE: Record<PaymentAction, string> = { paid: "Mark as paid", failed: "Mark as failed", held: "Put on hold", pending: "Retry payment", cancelled: "Cancel payment" };

/** Change the status of one or more payments (with UTR or reason where it matters). */
export function PaymentActionDialog({ action, items, onClose }: { action: PaymentAction | null; items: Payment[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [utr, setUtr] = useState("");
  const [reason, setReason] = useState("");
  const [paidOn, setPaidOn] = useState(todayIST());
  useEffect(() => {
    setUtr("");
    setReason("");
    setPaidOn(todayIST());
  }, [action, items]);
  const run = useMutation({
    mutationFn: () => api.post<{ done: number; errors: { id: string; message: string }[] }>("/admin/payments/payments/bulk", { ids: items.map((p) => p.id), status: action, utr: utr.trim() || null, reason: reason.trim() || null, paidOn }),
    onSuccess: (r) => {
      if (r.errors.length) toast.error(`${r.done} updated, ${r.errors.length} skipped: ${r.errors[0]!.message}`);
      else toast.success(`${r.done} payment${r.done === 1 ? "" : "s"} updated`);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["claims"] });
      onClose();
    },
  });
  if (!action) return null;
  const total = items.reduce((s, p) => s + Number(p.amount), 0);
  const needReason = action === "failed";
  const manual = action === "paid" && items.some((p) => p.status !== "pending");
  return (
    <Dialog
      open={!!action}
      onOpenChange={(v) => !v && onClose()}
      title={ACTION_TITLE[action]}
      description={items.length === 1 ? `${items[0]!.reference} · ${items[0]!.employeeName} · ${inr(items[0]!.amount)}` : `${items.length} payments · ${inr(total)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={action === "cancelled" || action === "failed" ? "danger" : "primary"} disabled={needReason && !reason.trim()} loading={run.isPending} onClick={() => run.mutate()}>
            {ACTION_TITLE[action]}
          </Button>
        </>
      }
    >
      {action === "pending" ? <Notice tone="sel">The payment keeps its reference and goes into the next bank file for this batch, with the employee's current bank details.</Notice> : null}
      {manual ? <Notice tone="sel">Use this when the money went out another way, for example a cheque or a separate transfer.</Notice> : null}
      {action === "paid" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paid on">
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          {items.length === 1 ? (
            <Field label="UTR (optional)">
              <Input value={utr} onChange={(e) => setUtr(e.target.value)} maxLength={40} />
            </Field>
          ) : null}
        </div>
      ) : null}
      {action !== "pending" ? (
        <Field label={needReason ? "Bank's reason" : "Note (optional)"}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={needReason ? "Account dormant, invalid IFSC, name mismatch" : manual ? "Cheque 004512" : ""} />
        </Field>
      ) : null}
    </Dialog>
  );
}

/** Upload the bank's status / MIS file to mark payments paid or failed by reference. */
export function ReconcileDialog({ batchId, open, onClose }: { batchId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ rows: number; paid: number; failed: number; unknown: string[]; alreadyUpdated: number; errors: string[] } | null>(null);
  useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
    }
  }, [open]);
  const run = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set("file", file!);
      return api.upload<NonNullable<typeof result>>(`/admin/payments/batches/${batchId}/reconcile`, fd);
    },
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["claims"] });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Reconcile with the bank"
      description="Upload the status file from your bank's portal. Rows are matched on the payment reference."
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!file} loading={run.isPending} onClick={() => run.mutate()}>
              Reconcile
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <>
          <button type="button" onClick={() => ref.current?.click()} className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[var(--radius-md)] border-0 bg-transparent p-5 text-center text-[13px] text-[var(--color-text)]" style={{ border: "1.5px dashed var(--tint-2)" }}>
            <Upload size={18} />
            {file ? <strong>{file.name}</strong> : "Choose the bank's status file · CSV, TXT (pipe or tab separated)"}
          </button>
          <input ref={ref} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="text-muted text-[12.5px]">The header row needs a reference column and a status column (Success, Paid, Rejected, Returned...). UTR and reason columns are picked up when present.</div>
        </>
      ) : (
        <div className="flex flex-col gap-1.5 text-[13.5px]">
          <Row label="Rows read" value={result.rows} />
          <Row label="Marked paid" value={<Tag tone="ok">{result.paid}</Tag>} />
          <Row label="Marked failed" value={<Tag tone={result.failed ? "bad" : "neutral"}>{result.failed}</Tag>} />
          <Row label="Already updated" value={result.alreadyUpdated} />
          {result.unknown.length ? <Notice tone="warn">References not in this batch: {result.unknown.slice(0, 8).join(", ")}{result.unknown.length > 8 ? "…" : ""}</Notice> : null}
          {result.errors.length ? <Notice tone="warn">{result.errors.slice(0, 4).join(" · ")}</Notice> : null}
        </div>
      )}
    </Dialog>
  );
}
