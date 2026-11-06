import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Paperclip, Upload, X } from "lucide-react";
import { fmtDate, inr, todayIST } from "@hrms/shared";
import { api, errorMessage, openFile, qs } from "@/lib/api";
import type { Claim, ClaimDetail, ClaimStatus, ExpenseCategory } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { KV, Loading, Notice } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { ReasonDialog } from "@/components/ui/reason-dialog";

const TONE: Record<ClaimStatus, Tone> = {
  pending_manager: "warn",
  pending_finance: "warn",
  approved: "accent",
  paid: "ok",
  rejected: "bad",
  cancelled: "neutral",
};
const LABEL: Record<ClaimStatus, string> = {
  pending_manager: "With manager",
  pending_finance: "With finance",
  approved: "Approved, unpaid",
  paid: "Paid",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function ClaimStatusTag({ status }: { status: ClaimStatus }) {
  return <Tag tone={TONE[status]}>{LABEL[status]}</Tag>;
}

const PERIOD: Record<string, string> = { claim: "per claim", day: "per day", month: "per month", trip: "per trip", night: "per night" };

/** "₹500 / day", "₹8 / km", "No limit". */
export function limitText(c: Pick<ExpenseCategory, "limitAmount" | "limitPeriod" | "ratePerKm">) {
  if (c.limitPeriod === "km") return `${inr(c.ratePerKm ?? 0)} per km`;
  if (c.limitAmount === null || c.limitAmount === undefined) return "No limit";
  return `${inr(c.limitAmount)} ${PERIOD[c.limitPeriod] ?? ""}`;
}

export const APPROVAL_TEXT: Record<string, string> = {
  manager: "Manager",
  finance: "Finance",
  manager_finance: "Manager, then finance",
};

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const MAX = 10 * 1024 * 1024;

interface EmpHit {
  id: string;
  fullName: string;
  employeeCode: string;
}

/**
 * New claim form. Employees file their own (ESS); admins with edit rights can
 * file on behalf of an employee (pickEmployee).
 */
export function ClaimDialog({ open, onClose, categories, pickEmployee, endpoint }: { open: boolean; onClose: () => void; categories: ExpenseCategory[]; pickEmployee?: boolean; endpoint: string }) {
  const qc = useQueryClient();
  const active = useMemo(() => categories.filter((c) => c.active), [categories]);
  const blank = () => ({ categoryId: active[0]?.id ?? "", expenseDate: todayIST(), amount: "", km: "", vendor: "", gstin: "", gstAmount: "", project: "", description: "" });
  const [f, setF] = useState(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [emp, setEmp] = useState<EmpHit | null>(null);
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(blank());
    setFiles([]);
    setError(null);
    setEmp(null);
    setSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hits = useQuery({
    queryKey: ["employees", "pick", search],
    queryFn: () => api.get<{ rows: EmpHit[] }>(`/admin/employees${qs({ q: search, pageSize: 6 })}`),
    enabled: !!pickEmployee && open && search.trim().length >= 2 && !emp,
  });

  const cat = active.find((c) => c.id === f.categoryId);
  const perKm = cat?.limitPeriod === "km";
  const amount = perKm ? Math.round(Number(f.km || 0) * Number(cat?.ratePerKm ?? 0) * 100) / 100 : Number(f.amount || 0);
  const needsReceipt = !!cat && amount > Number(cat.receiptRequiredAbove);
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setF((x) => ({ ...x, [k]: v }));

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (!ACCEPT.split(",").includes(file.type)) {
        setError("Receipts must be PDF, PNG, JPG or WebP");
        continue;
      }
      if (file.size > MAX) {
        setError("Receipts must be 10 MB or smaller");
        continue;
      }
      next.push(file);
    }
    setFiles(next.slice(0, 5));
  };

  const submit = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      if (pickEmployee && !emp) throw new Error("Pick the employee");
      if (!cat) throw new Error("Pick a category");
      if (perKm ? !Number(f.km) : !Number(f.amount)) throw new Error(perKm ? "Enter the distance in km" : "Enter the amount");
      if (f.description.trim().length < 3) throw new Error("Say what the expense was for");
      if (needsReceipt && !files.length) throw new Error(`Attach a receipt for ${cat.name} claims above ${inr(cat.receiptRequiredAbove)}`);
      const data = {
        employeeId: emp?.id,
        categoryId: cat.id,
        expenseDate: f.expenseDate,
        amount: perKm ? undefined : Number(f.amount),
        km: perKm ? Number(f.km) : undefined,
        vendor: f.vendor.trim() || null,
        gstin: cat.gstCapture && f.gstin.trim() ? f.gstin.trim().toUpperCase() : null,
        gstAmount: cat.gstCapture && f.gstAmount ? Number(f.gstAmount) : null,
        project: f.project.trim() || null,
        description: f.description.trim(),
      };
      const fd = new FormData();
      fd.set("data", JSON.stringify(data));
      for (const file of files) fd.append("files", file);
      return api.upload<{ claim: Claim; overLimit: { over: boolean; used: number; limit: number | null } }>(endpoint, fd);
    },
    onSuccess: (r) => {
      toast.success(`${r.claim.code} submitted${r.overLimit.over ? ". It's over the policy limit, so finance will also review it." : ""}`);
      qc.invalidateQueries({ queryKey: ["claims"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="New reimbursement claim"
      description={pickEmployee ? "File a claim on behalf of an employee. It follows the normal approval chain." : "Claims are paid with your salary once approved."}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>
            Submit claim
          </Button>
        </>
      }
    >
      {pickEmployee ? (
        <Field label="Employee">
          {emp ? (
            <div className="input flex items-center justify-between">
              <span>
                {emp.fullName} <span className="text-muted">· {emp.employeeCode}</span>
              </span>
              <Button icon size="sm" variant="ghost" aria-label="Change employee" onClick={() => setEmp(null)}>
                <X size={14} />
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input autoFocus placeholder="Search by name or employee ID" value={search} onChange={(e) => setSearch(e.target.value)} />
              {hits.data?.rows.length ? (
                <div className="card elev-md absolute inset-x-0 top-[calc(100%+4px)] z-10 !gap-0 !p-1">
                  {hits.data.rows.map((h) => (
                    <button key={h.id} type="button" className="cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--tint-1)]" onClick={() => setEmp(h)}>
                      {h.fullName} <span className="text-muted">· {h.employeeCode}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" hint={cat ? `${limitText(cat)} · approval: ${APPROVAL_TEXT[cat.approval]}` : undefined}>
          <Select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            {active.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expense date">
          <Input type="date" max={todayIST()} value={f.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} />
        </Field>
        {perKm ? (
          <Field label="Distance (km)" hint={`${inr(cat?.ratePerKm ?? 0)} per km = ${inr(amount)}`}>
            <Input inputMode="decimal" value={f.km} onChange={(e) => set("km", e.target.value.replace(/[^\d.]/g, ""))} placeholder="120" />
          </Field>
        ) : (
          <Field label="Amount (₹)">
            <Input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} placeholder="1450" />
          </Field>
        )}
        <Field label="Vendor">
          <Input value={f.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Uber, Hotel Fern, Jio" maxLength={120} />
        </Field>
        {cat?.gstCapture ? (
          <>
            <Field label="Vendor GSTIN" hint="Optional. Lets the company claim input credit.">
              <Input value={f.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} placeholder="24AABCS1234F1Z5" maxLength={15} />
            </Field>
            <Field label="GST amount (₹)">
              <Input inputMode="decimal" value={f.gstAmount} onChange={(e) => set("gstAmount", e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
            </Field>
          </>
        ) : null}
        <Field label="Project / client" span>
          <Input value={f.project} onChange={(e) => set("project", e.target.value)} placeholder="Optional" maxLength={120} />
        </Field>
        <Field label="What was it for?" span>
          <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Ahmedabad to Mundra for client meeting, cab and toll" maxLength={300} />
        </Field>
      </div>
      <div
        className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[var(--radius-md)] p-4 text-center text-[13px]"
        style={{ border: `1.5px dashed ${drag ? "var(--color-accent)" : "var(--tint-2)"}`, color: "color-mix(in srgb, var(--color-text) 75%, transparent)" }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
      >
        <Upload size={18} />
        <span>
          Drop receipt or invoice, or click to choose · JPG, PNG, PDF up to 10 MB
          {needsReceipt ? <strong> · required</strong> : null}
        </span>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      </div>
      {files.length ? (
        <div className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <span key={i} className="tag tag-ok inline-flex items-center gap-1.5">
              <Paperclip size={12} /> {file.name}
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-inherit" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Dialog>
  );
}

/** Claim details with receipts. Admins decide; employees can cancel while it's waiting. */
export function ClaimDetailDialog({ id, onClose, mode }: { id: string | null; onClose: () => void; mode: "admin" | "ess" }) {
  const qc = useQueryClient();
  const base = mode === "admin" ? "/admin/reimbursements/claims" : "/ess/claims";
  const receiptBase = mode === "admin" ? "/admin/reimbursements/receipts" : "/ess/claims/receipts";
  const q = useQuery({ queryKey: ["claims", "detail", mode, id], queryFn: () => api.get<ClaimDetail>(`${base}/${id}`), enabled: !!id });
  const [rejecting, setRejecting] = useState(false);
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["claims"] });
    onClose();
  };
  const approve = useMutation({ mutationFn: () => api.post<Claim>(`${base}/${id}/decision`, { decision: "approved" }), onSuccess: (c) => done(c.status === "approved" ? `${c.code} approved. It will be paid with the next payroll.` : `${c.code} approved and sent to finance`) });
  const cancel = useMutation({ mutationFn: () => api.post<Claim>(`${base}/${id}/cancel`), onSuccess: (c) => done(`${c.code} cancelled`) });
  const c = q.data;
  const waiting = c && (c.status === "pending_manager" || c.status === "pending_finance");
  return (
    <>
      <Dialog
        open={!!id && !rejecting}
        onOpenChange={(v) => !v && onClose()}
        title={c ? `${c.code} · ${c.category}` : "Claim"}
        description={c ? (mode === "admin" ? `${c.employeeName} · ${c.employeeCode}${c.department ? ` · ${c.department}` : ""}` : `Submitted ${fmtDate(c.createdAt.slice(0, 10))}`) : undefined}
        width={560}
        footer={
          c ? (
            mode === "admin" ? (
              c.canDecide ? (
                <>
                  <Button variant="danger" onClick={() => setRejecting(true)}>
                    Reject
                  </Button>
                  <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>
                    {c.status === "pending_manager" ? "Approve" : "Approve for payment"}
                  </Button>
                </>
              ) : (
                <Button onClick={onClose}>Close</Button>
              )
            ) : waiting ? (
              <>
                <Button onClick={onClose}>Close</Button>
                <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                  Cancel claim
                </Button>
              </>
            ) : (
              <Button onClick={onClose}>Close</Button>
            )
          ) : null
        }
      >
        {q.isLoading ? <Loading /> : null}
        {c ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-4 py-3" style={{ background: "var(--tint-1)" }}>
              <div>
                <div className="text-muted text-[12px]">Amount</div>
                <div className="num text-[24px] font-medium">{inr(c.amount)}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <ClaimStatusTag status={c.status} />
                {c.overLimit ? <Tag tone="warn">Over policy limit</Tag> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[13.5px]">
              <KV label="Expense date">{fmtDate(c.expenseDate)}</KV>
              <KV label="Category">{c.category}{c.km ? ` · ${c.km} km` : ""}</KV>
              <KV label="Vendor">{c.vendor}</KV>
              <KV label="Project / client">{c.project}</KV>
              {c.gstin ? <KV label="GSTIN">{c.gstin}</KV> : null}
              {c.gstin ? <KV label="GST amount">{c.gstAmount ? inr(c.gstAmount) : "—"}</KV> : null}
              <KV label="Description" span>{c.description}</KV>
              {mode === "admin" ? <KV label="Reporting manager">{c.managerName}</KV> : null}
              <KV label="Approval">{APPROVAL_TEXT[c.approval]}{c.overLimit && c.approval === "manager" ? ", then finance (over limit)" : ""}</KV>
              {c.payment ? <KV label="Payment" span>{c.payment}</KV> : null}
            </div>
            <Timeline c={c} />
            {c.rejectionReason ? <Notice tone="bad">Rejected: {c.rejectionReason}</Notice> : null}
            {mode === "admin" && !c.canDecide && c.blockedReason && waiting ? <Notice tone="sel">{c.blockedReason}</Notice> : null}
            <div>
              <div className="text-muted mb-1.5 text-[12px]">Receipts</div>
              {c.receiptFiles.length ? (
                <div className="flex flex-wrap gap-2">
                  {c.receiptFiles.map((r) => (
                    <Button key={r.id} size="sm" onClick={() => openFile(`${receiptBase}/${r.id}`).catch((e) => toast.error(errorMessage(e)))}>
                      <FileText size={14} /> {r.fileName}
                    </Button>
                  ))}
                </div>
              ) : (
                <span className="text-muted text-[13px]">No receipt attached</span>
              )}
            </div>
          </>
        ) : null}
      </Dialog>
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={c ? `Reject ${c.code}` : "Reject claim"}
        onConfirm={async (note) => {
          const r = await api.post<Claim>(`${base}/${id}/decision`, { decision: "rejected", note });
          done(`${r.code} rejected`);
        }}
      />
    </>
  );
}

function Timeline({ c }: { c: Claim }) {
  const steps: [string, string | null][] = [
    ["Submitted", c.createdAt],
    ...(c.managerApprovedAt ? [["Manager approved", c.managerApprovedAt] as [string, string]] : []),
    ...(c.financeApprovedAt ? [["Finance approved", c.financeApprovedAt] as [string, string]] : []),
    ...(c.rejectedAt ? [["Rejected", c.rejectedAt] as [string, string]] : []),
    ...(c.paidAt ? [["Paid with salary", c.paidAt] as [string, string]] : []),
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
      {steps.map(([label, at]) => (
        <span key={label}>
          <span className="text-muted">{label}</span> {at ? fmtDate(at.slice(0, 10), false) : ""}
        </span>
      ))}
    </div>
  );
}
