import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowLeft, CheckCheck, Download, FileCheck2, Plus, Upload } from "lucide-react";
import { fmtDate, inr } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { ExportDialog } from "@/components/payments/ExportDialog";
import { useSession } from "@/lib/session";
import type { BatchDetail as Detail, Payment } from "@/lib/types";
import { Card, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { ErrorState, KV, Loading, Notice } from "@/components/ui/page";
import { PersonCell } from "@/components/ui/avatar";
import { BatchStatusTag, PaymentActionDialog, PaymentStatusTag, ReconcileDialog, TYPE_LABEL, type PaymentAction } from "@/components/payments/shared";

type F = "all" | "pending" | "paid" | "failed" | "held";

export function paymentColumns(opts: { batch?: boolean } = {}): ColumnDef<Payment, any>[] {
  return [
    { id: "ref", header: "Reference", accessorFn: (p) => p.reference, cell: ({ row: { original: p } }) => <div><div className="font-semibold">{p.reference}</div>{p.description ? <div className="text-muted text-[11.5px]">{p.description}</div> : null}</div> },
    ...(opts.batch ? [{ id: "batch", header: "Batch", accessorFn: (p: Payment) => p.batchCode, cell: ({ row: { original: p } }: { row: { original: Payment } }) => <Link to={`/payments/batches/${p.batchId}`}>{p.batchCode}</Link> } as ColumnDef<Payment, any>] : []),
    { id: "employee", header: "Employee", accessorFn: (p) => p.employeeName, cell: ({ row: { original: p } }) => <PersonCell employeeId={p.employeeId} name={p.employeeName} sub={p.employeeCode} /> },
    { id: "bank", header: "Bank", accessorFn: (p) => p.bankName ?? "", cell: ({ row: { original: p } }) => (p.accountLast4 ? <div>{p.bankName}<div className="text-muted text-[11.5px]">····{p.accountLast4} · {p.ifsc}</div></div> : <span className="text-muted">Not on file</span>) },
    { id: "amount", header: "Amount", accessorFn: (p) => Number(p.amount), meta: { align: "right" }, cell: ({ getValue }) => <span className="font-semibold">{inr(getValue<number>())}</span> },
    { id: "status", header: "Status", accessorFn: (p) => p.status, cell: ({ row: { original: p } }) => <PaymentStatusTag status={p.status} /> },
    {
      id: "detail",
      header: "UTR / reason",
      accessorFn: (p) => p.utr ?? p.failureReason ?? "",
      cell: ({ row: { original: p } }) => (
        <span className="block max-w-[260px] truncate text-[12.5px]" style={{ color: p.failureReason ? "var(--warn-fg)" : undefined }} title={p.failureReason ?? p.note ?? p.utr ?? ""}>
          {p.status === "paid" ? (p.utr ?? p.note ?? (p.paidAt ? `Paid ${fmtDate(p.paidAt.slice(0, 10))}` : "")) : (p.failureReason ?? "—")}
        </span>
      ),
    },
    { id: "attempts", header: "Tries", accessorFn: (p) => p.attempts, meta: { align: "right" } },
  ];
}

/** Row actions for a payment, given what the batch allows. */
export function paymentActions(p: Payment, canEdit: boolean, sent: boolean, act: (a: PaymentAction, p: Payment[]) => void) {
  if (!canEdit) return [];
  const out: { label: string; onSelect: () => void; danger?: boolean }[] = [];
  if (p.status === "pending" && sent) out.push({ label: "Mark paid", onSelect: () => act("paid", [p]) }, { label: "Mark failed", onSelect: () => act("failed", [p]), danger: true });
  if (p.status === "failed" || p.status === "held") out.push({ label: "Retry in next file", onSelect: () => act("pending", [p]) }, { label: "Mark paid outside the file", onSelect: () => act("paid", [p]) });
  if (p.status === "failed" || p.status === "pending") out.push({ label: "Put on hold", onSelect: () => act("held", [p]) });
  if (p.status === "failed" || p.status === "held") out.push({ label: "Cancel payment", onSelect: () => act("cancelled", [p]), danger: true });
  out.push({ label: "Update bank details", onSelect: () => window.open(`/employees/${p.employeeId}/edit`, "_self") });
  return out;
}

export default function BatchDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["payments", "batch", id], queryFn: () => api.get<Detail>(`/admin/payments/batches/${id}`) });
  const [filter, setFilter] = useState<F>("all");
  const [action, setAction] = useState<{ a: PaymentAction; items: Payment[] } | null>(null);
  const [reconcile, setReconcile] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["payments"] });
    qc.invalidateQueries({ queryKey: ["payroll"] });
    qc.invalidateQueries({ queryKey: ["claims"] });
  };
  const approve = useMutation({ mutationFn: () => api.post(`/admin/payments/batches/${id}/approve`), onSuccess: () => (toast.success("Batch approved. Download the bank file next."), refresh()) });
  const allPaid = useMutation({ mutationFn: () => api.post<{ done: number }>(`/admin/payments/batches/${id}/mark-all-paid`, {}), onSuccess: (r) => (toast.success(`${r.done} payment${r.done === 1 ? "" : "s"} marked paid`), refresh()) });
  const columns = useMemo(() => paymentColumns(), []);
  const b = q.data;
  const rows = useMemo(() => (b?.payments ?? []).filter((p) => (filter === "all" ? p.status !== "cancelled" : p.status === filter)), [b, filter]);
  if (q.isLoading) return <Loading />;
  if (q.error || !b) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const canEdit = can("payments", "edit");
  const sent = b.status === "processing" || b.status === "completed";
  const editableLines = b.status === "draft" && (b.type === "bonus" || b.type === "other") && canEdit;
  const act = (a: PaymentAction, items: Payment[]) => setAction({ a, items });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button icon variant="ghost" aria-label="Back" onClick={() => nav(-1)}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <div className="flex items-center gap-2 text-[20px] font-medium">
              {b.code} <BatchStatusTag status={b.status} />
            </div>
            <div className="text-muted text-[13px]">
              {TYPE_LABEL[b.type]} · {b.label} · {fmtDate(b.paymentDate)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editableLines ? (
            <Button onClick={() => setAdding(true)}>
              <Plus size={15} /> Add payment
            </Button>
          ) : null}
          {b.status === "draft" && can("payments", "approve") ? (
            <Button variant="primary" disabled={!b.canApprove} title={b.approveBlocked ?? undefined} loading={approve.isPending} onClick={() => approve.mutate()}>
              <FileCheck2 size={15} /> Approve batch
            </Button>
          ) : null}
          {(b.status === "approved" || (sent && b.pending > 0)) && can("payments", "export") ? (
            <Button variant={b.status === "approved" ? "primary" : "secondary"} onClick={() => setExporting(true)}>
              <Download size={15} /> {b.exportCount ? "Download retry file" : "Download bank file"}
            </Button>
          ) : null}
          {sent && canEdit ? (
            <Button onClick={() => setReconcile(true)}>
              <Upload size={15} /> Reconcile
            </Button>
          ) : null}
          {b.status === "processing" && b.pending > 0 && canEdit ? (
            <Button loading={allPaid.isPending} onClick={() => allPaid.mutate()}>
              <CheckCheck size={15} /> Mark all pending paid
            </Button>
          ) : null}
          {(b.status === "draft" || b.status === "approved") && canEdit ? (
            <Button variant="danger" onClick={() => setCancelling(true)}>
              Cancel batch
            </Button>
          ) : null}
        </div>
      </div>
      {b.status === "draft" && b.approveBlocked ? <Notice tone="sel">{b.approveBlocked}</Notice> : null}
      {b.status === "draft" && !can("payments", "approve") ? <Notice tone="sel">A finance approver needs to approve this batch before the bank file can be downloaded.</Notice> : null}
      {b.type === "bonus" ? <Notice tone="warn">Bonus is taxable salary. This batch doesn't deduct TDS, so include it in the employee's TDS computation, or pay it through payroll as a one-time earning instead.</Notice> : null}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))" }}>
        <StatCard label="Total" value={inr(b.amount)} meta={`${b.count} payments`} />
        <StatCard label="Paid" value={inr(b.paidAmount)} meta={`${b.paid} payments`} onClick={() => setFilter("paid")} />
        <StatCard label="Pending" value={b.pending} meta={sent ? "waiting for the bank's result" : "in the next bank file"} onClick={() => setFilter("pending")} />
        <StatCard label="Failed / held" value={`${b.failed} / ${b.held}`} meta="retry, hold or pay another way" onClick={() => setFilter(b.failed ? "failed" : "held")} />
      </div>
      <Card className="!gap-2">
        <div className="grid gap-3 text-[13.5px] sm:grid-cols-4">
          <KV label="Debit account">{b.bank}</KV>
          <KV label="File format">{b.formatLabel}</KV>
          <KV label="Bank file">{b.exportedAt ? `Downloaded ${fmtDate(b.exportedAt.slice(0, 10))}${b.exportCount > 1 ? ` · ${b.exportCount} files` : ""}` : "Not yet"}</KV>
          <KV label="Payroll">{b.payrollRunId ? <Link to={`/payroll/run/${b.payrollRunId}`}>Open payroll run</Link> : "—"}</KV>
          {b.notes ? <KV label="Notes" span>{b.notes}</KV> : null}
        </div>
      </Card>
      <TableCard>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(p) => p.id}
          pageSize={20}
          storageKey="payment-lines"
          empty="No payments for this filter"
          rowActions={(p) => [
            ...paymentActions(p, canEdit, sent, act),
            ...(editableLines ? [{ label: "Remove from batch", danger: true, onSelect: () => api.del(`/admin/payments/batches/${id}/lines/${p.id}`).then(refresh).catch((e) => toast.error(errorMessage(e))) }] : []),
          ]}
          bulkActions={
            canEdit && sent
              ? [
                  { label: "Mark paid", onRun: (sel) => act("paid", sel) },
                  { label: "Mark failed", onRun: (sel) => act("failed", sel) },
                  { label: "Retry", onRun: (sel) => act("pending", sel) },
                ]
              : undefined
          }
          toolbar={<Segmented<F> value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "pending", label: "Pending" }, { value: "paid", label: "Paid" }, { value: "failed", label: "Failed" }, { value: "held", label: "On hold" }]} />}
        />
      </TableCard>
      <PaymentActionDialog action={action?.a ?? null} items={action?.items ?? []} onClose={() => setAction(null)} />
      {exporting ? <ExportDialog batch={b} onClose={() => setExporting(false)} onDone={refresh} /> : null}
      <ReconcileDialog batchId={b.id} open={reconcile} onClose={() => setReconcile(false)} />
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${b.code}`}
        confirmLabel="Cancel batch"
        onConfirm={async (reason) => {
          await api.post(`/admin/payments/batches/${id}/cancel`, { reason });
          toast.success(`${b.code} cancelled`);
          refresh();
        }}
      />
      <AddLineDialog open={adding} batchId={b.id} onClose={() => setAdding(false)} onDone={refresh} />
    </div>
  );
}

function AddLineDialog({ open, batchId, onClose, onDone }: { open: boolean; batchId: string; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [emp, setEmp] = useState<{ id: string; fullName: string; employeeCode: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const hits = useQuery({ queryKey: ["employees", "pick", search], queryFn: () => api.get<{ rows: { id: string; fullName: string; employeeCode: string }[] }>(`/admin/employees?q=${encodeURIComponent(search)}&pageSize=6`), enabled: open && search.trim().length >= 2 && !emp });
  const add = useMutation({
    mutationFn: () => api.post(`/admin/payments/batches/${batchId}/lines`, { employeeId: emp!.id, amount: Number(amount), description: description.trim() || null }),
    onSuccess: () => {
      toast.success("Payment added");
      setEmp(null);
      setSearch("");
      setAmount("");
      setDescription("");
      onDone();
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Add payment"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!emp || !Number(amount)} loading={add.isPending} onClick={() => add.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <Field label="Employee">
        {emp ? (
          <div className="input flex items-center justify-between">
            <span>
              {emp.fullName} <span className="text-muted">· {emp.employeeCode}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEmp(null)}>
              Change
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} />
        </Field>
      </div>
    </Dialog>
  );
}
