import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download, PlayCircle } from "lucide-react";
import { fmtDate, inr, inrCompact, todayIST } from "@hrms/shared";
import { api, download, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Invoice } from "@/lib/types";
import { Card, CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { InvoiceDialog, InvoiceStatusTag } from "@/components/billing/InvoiceView";
import { confirmAction } from "@/components/ui/confirm";

interface Summary {
  period: string;
  periodLabel: string;
  invoices: number;
  invoiced: number;
  collected: number;
  collectionRate: number;
  gstPayable: number;
  gstDue: string;
  overdue: { amount: number; tenants: number; invoices: number };
}
interface Draft {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  planName: string;
  seats: number;
  activeEmployees: number;
  rate: number;
  subtotal: number;
  total: number;
  skip: string | null;
}
interface Dunning {
  policy: { reminderDays: number[]; pastDueAfter: number; suspendAfter: number };
  rows: { invoiceId: string; number: string; tenantName: string; tenantStatus: string; total: number; dueOn: string; daysOverdue: number; remindersSent: number; action: string | null; hasEmail: boolean }[];
}

const prevMonth = () => {
  const [y, m] = todayIST().split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (p: string) => `${MON[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export default function Billing() {
  const { me } = useSession();
  const canBill = me?.platformRole === "super_admin" || me?.platformRole === "finance";
  const qc = useQueryClient();
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<string | null>(null);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [running, setRunning] = useState(false);
  const [dunning, setDunning] = useState(false);
  const summary = useQuery({ queryKey: ["platform", "billing", "summary"], queryFn: () => api.get<Summary>("/platform/billing/summary") });
  const list = useQuery({ queryKey: ["platform", "billing", "invoices", period, status, q], queryFn: () => api.get<Invoice[]>(`/platform/billing/invoices${qs({ period, status, q })}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform"] });
  const remind = useMutation({ mutationFn: (id: string) => api.post(`/platform/billing/invoices/${id}/remind`), onSuccess: () => (toast.success("Reminder sent"), refresh()) });
  const s = summary.data;
  const months = useMemo(() => {
    const [y, m] = todayIST().split("-").map(Number) as [number, number];
    return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  }, []);
  const columns = useMemo<ColumnDef<Invoice, any>[]>(
    () => [
      { id: "number", header: "Invoice", accessorFn: (i) => i.number, cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { id: "tenant", header: "Tenant", accessorFn: (i) => i.tenantName, cell: ({ row: { original: i } }) => <div>{i.tenantName}<div className="text-muted text-[11.5px]">{i.planName} · {i.seats} seats</div></div> },
      { id: "period", header: "Period", accessorFn: (i) => i.period, cell: ({ row: { original: i } }) => i.periodLabel },
      { id: "subtotal", header: "Subtotal", accessorFn: (i) => Number(i.subtotal), meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "gst", header: "GST", accessorFn: (i) => Number(i.cgst) + Number(i.sgst) + Number(i.igst), meta: { align: "right" }, cell: ({ row: { original: i } }) => <div>{inr(Number(i.cgst) + Number(i.sgst) + Number(i.igst))}<div className="text-muted text-[11px]">{Number(i.igst) ? "IGST" : "CGST + SGST"}</div></div> },
      { id: "total", header: "Total", accessorFn: (i) => Number(i.total), meta: { align: "right" }, cell: ({ getValue }) => <span className="font-medium">{inr(getValue<number>())}</span> },
      { id: "due", header: "Due", accessorFn: (i) => i.dueOn, cell: ({ row: { original: i } }) => (i.status === "paid" ? <span className="text-muted">Paid {i.paidOn ? fmtDate(i.paidOn, false) : ""}</span> : fmtDate(i.dueOn)) },
      { id: "status", header: "Status", accessorFn: (i) => i.displayStatus, cell: ({ row: { original: i } }) => <div className="flex items-center gap-1.5"><InvoiceStatusTag status={i.displayStatus} />{i.remindersSent ? <span className="text-muted text-[11px]">{i.remindersSent} reminder{i.remindersSent === 1 ? "" : "s"}</span> : null}</div> },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Billing & invoices"
        sub="Subscription invoices to tenants, collections and GST"
        actions={
          canBill ? (
            <>
              <Button onClick={() => download(`/platform/billing/gstr1.csv?period=${todayIST().slice(0, 7)}`, "gstr1.csv").catch((e) => toast.error(errorMessage(e)))}>
                <Download size={16} /> GSTR-1 export
              </Button>
              <Button variant="primary" onClick={() => setRunning(true)}>
                <PlayCircle size={16} /> Run billing
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))" }}>
        <StatCard label={`Invoiced · ${s ? label(s.period) : ""}`} value={s ? inrCompact(s.invoiced) : "—"} meta={s ? `${s.invoices} invoice${s.invoices === 1 ? "" : "s"} incl. GST` : undefined} />
        <StatCard label="Collected" value={s ? inrCompact(s.collected) : "—"} meta={s ? `${s.collectionRate}% of invoiced` : undefined} />
        <StatCard label="Overdue" value={s ? inrCompact(s.overdue.amount) : "—"} meta={s?.overdue.tenants ? <Tag tone="warn">{s.overdue.tenants} tenant{s.overdue.tenants === 1 ? "" : "s"}</Tag> : "Nothing overdue"} onClick={() => setStatus("overdue")} />
        <StatCard label="GST payable (GSTR-3B)" value={s ? inrCompact(s.gstPayable) : "—"} meta={s ? `for ${label(s.period)} · due ${fmtDate(s.gstDue, false)}` : undefined} />
      </div>
      {list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={list.data ?? []}
          columns={columns}
          getRowId={(i) => i.id}
          loading={list.isFetching}
          pageSize={15}
          storageKey="platform-invoices"
          onRowClick={(i) => setView(i.id)}
          empty="No invoices for this filter"
          rowActions={(i) => [
            { label: "View / download", onSelect: () => setView(i.id) },
            ...(canBill && i.status === "issued"
              ? [
                  { label: "Record payment", onSelect: () => setPaying(i) },
                  { label: "Send reminder", onSelect: () => remind.mutate(i.id) },
                  { label: "Charge via autopay", onSelect: () => api.post<{ scheduledFor: string }>(`/platform/billing/invoices/${i.id}/autopay`).then((r) => toast.success(`Autopay debit scheduled for ${fmtDate(r.scheduledFor.slice(0, 10))}`)).catch((e) => toast.error(errorMessage(e))) },
                  { label: "Withdraw autopay debit", onSelect: () => void confirmAction({ title: `Withdraw the autopay debit for ${i.number}?`, body: "The customer will need to pay this invoice another way.", confirmLabel: "Withdraw", danger: true }).then((ok) => { if (ok) api.post(`/platform/billing/invoices/${i.id}/autopay/cancel`).then(() => toast.success("Autopay debit withdrawn")).catch((e) => toast.error(errorMessage(e))); }) },
                  ...(me?.platformRole === "super_admin" ? [{ label: "Void invoice", danger: true, onSelect: () => setVoiding(i) }] : []),
                ]
              : []),
          ]}
          toolbar={
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tenant, invoice or GSTIN" className="!w-[240px]" aria-label="Search" />
              <Select className="!w-[160px]" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
                <option value="">All periods</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {label(m)}
                  </option>
                ))}
              </Select>
              <Select className="!w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                <option value="">All statuses</option>
                <option value="issued">Unpaid</option>
                <option value="overdue">Overdue</option>
                <option value="paid">Paid</option>
                <option value="void">Void</option>
              </Select>
            </>
          }
        />
      </TableCard>
      <Card className="!gap-2" style={{ padding: 18 }}>
        <CardHeader
          title="Dunning policy"
          sub="What happens when an invoice isn't paid"
          actions={
            canBill ? (
              <Button onClick={() => setDunning(true)}>Review overdue accounts</Button>
            ) : null
          }
        />
        <div className="flex flex-col gap-1 text-[13.5px]">
          <div>Day 0 · invoice emailed with UPI and bank details, due in 7 days</div>
          <div>1, 7 and 15 days overdue · reminder to the billing email</div>
          <div>15 days overdue · account marked past due, with a banner for every admin</div>
          <div>45 days overdue · account suspended. Data is kept, and access returns once the invoice is paid.</div>
        </div>
      </Card>
      <InvoiceDialog path={view ? `/platform/billing/invoices/${view}` : null} onClose={() => setView(null)} />
      <PaymentDialog invoice={paying} onClose={() => setPaying(null)} onDone={refresh} />
      <ReasonDialog
        open={!!voiding}
        onOpenChange={(v) => !v && setVoiding(null)}
        title={voiding ? `Void ${voiding.number}` : "Void invoice"}
        confirmLabel="Void invoice"
        onConfirm={async (reason) => {
          await api.post(`/platform/billing/invoices/${voiding!.id}/void`, { reason });
          toast.success("Invoice voided. You can bill the period again.");
          refresh();
        }}
      />
      <RunDialog open={running} onClose={() => setRunning(false)} onDone={refresh} />
      <DunningDialog open={dunning} onClose={() => setDunning(false)} onDone={refresh} />
    </>
  );
}

function PaymentDialog({ invoice, onClose, onDone }: { invoice: Invoice | null; onClose: () => void; onDone: () => void }) {
  const [paidOn, setPaidOn] = useState(todayIST());
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  const pay = useMutation({
    mutationFn: () => api.post<{ restored: boolean; autopay: { cancelled: number; stillScheduled: number } | null }>(`/platform/billing/invoices/${invoice!.id}/payment`, { paidOn, method, reference: reference.trim() || null }),
    onSuccess: (r) => {
      toast.success(`${r.restored ? "Payment recorded and the account is active again" : "Payment recorded"}${r.autopay?.cancelled ? ". The scheduled autopay debit was withdrawn" : ""}`);
      if (r.autopay?.stillScheduled) toast.warning("An autopay debit for this invoice is already with the bank and couldn't be stopped. If it goes through, refund it (flagged in the audit log).");
      setReference("");
      onDone();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!invoice}
      onOpenChange={(v) => !v && onClose()}
      title="Record payment"
      description={invoice ? `${invoice.number} · ${invoice.tenantName} · ${inr(invoice.total)}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate()}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Received on">
          <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="upi">UPI</option>
            <option value="neft">NEFT</option>
            <option value="rtgs">RTGS</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Reference (UTR, cheque no.)" span>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
        </Field>
      </div>
    </Dialog>
  );
}

function RunDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [period, setPeriod] = useState(prevMonth());
  const preview = useQuery({ queryKey: ["platform", "billing", "preview", period], queryFn: () => api.post<{ drafts: Draft[]; count: number; total: number }>("/platform/billing/run/preview", { period }), enabled: open });
  const run = useMutation({
    mutationFn: () => api.post<{ created: number; emailed: number; autopay: number; total: number }>("/platform/billing/run", { period }),
    onSuccess: (r) => {
      toast.success(`${r.created} invoice${r.created === 1 ? "" : "s"} issued (${inr(r.total)}), ${r.emailed} emailed${r.autopay ? `, ${r.autopay} on autopay` : ""}`);
      onDone();
      onClose();
    },
  });
  const p = preview.data;
  const months = Array.from({ length: 6 }, (_, i) => {
    const [y, m] = todayIST().split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, m - 2 - i, 1)).toISOString().slice(0, 7);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Run billing"
      description="Invoices each billable tenant for the month, on active employees (at least the plan minimum), with GST by place of supply."
      width={720}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!p?.count} loading={run.isPending} onClick={() => run.mutate()}>
            Issue {p?.count ?? 0} invoice{p?.count === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <Field label="Billing month">
        <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </Select>
      </Field>
      {preview.isLoading ? <Loading /> : null}
      {preview.error ? <Notice tone="bad">{errorMessage(preview.error)}</Notice> : null}
      {p ? (
        <>
          <Notice tone="sel">
            {p.count} to invoice · {inr(p.total)} including GST
          </Notice>
          <div className="max-h-[45vh] overflow-auto">
            <table className="table text-[13px]">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Plan</th>
                  <th style={{ textAlign: "right" }}>Seats</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {p.drafts.map((d) => (
                  <tr key={d.tenantId} style={{ opacity: d.skip ? 0.6 : 1 }}>
                    <td>
                      {d.tenantName} <span className="text-muted">· {d.tenantCode}</span>
                    </td>
                    <td>{d.planName}</td>
                    <td style={{ textAlign: "right" }}>{d.seats}</td>
                    <td style={{ textAlign: "right" }}>{d.skip ? "—" : inr(d.total)}</td>
                    <td className="text-muted">{d.skip ?? (d.seats > d.activeEmployees ? `Plan minimum (${d.activeEmployees} active)` : `${inr(d.rate)} per employee`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

function DunningDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ["platform", "billing", "dunning"], queryFn: () => api.get<Dunning>("/platform/billing/dunning"), enabled: open });
  const run = useMutation({
    mutationFn: () => api.post<{ reminded: number; pastDue: number; suspended: number }>("/platform/billing/dunning/run"),
    onSuccess: (r) => {
      toast.success(`${r.reminded} reminders sent, ${r.pastDue} marked past due, ${r.suspended} suspended`);
      onDone();
      onClose();
    },
  });
  const rows = q.data?.rows ?? [];
  const todo = rows.filter((r) => r.action);
  const ACTION: Record<string, string> = { remind: "Send reminder", past_due: "Mark past due + reminder", suspend: "Suspend + reminder" };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Overdue accounts"
      description="Review what the dunning policy will do today before running it."
      width={760}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!todo.length} loading={run.isPending} onClick={() => run.mutate()}>
            Run {todo.length} action{todo.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {q.isLoading ? <Loading /> : null}
      {!q.isLoading && !rows.length ? <Notice tone="ok">No overdue invoices.</Notice> : null}
      {rows.length ? (
        <table className="table text-[13px]">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Tenant</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th style={{ textAlign: "right" }}>Days overdue</th>
              <th>Today</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.invoiceId}>
                <td>{r.number}</td>
                <td>
                  {r.tenantName} {r.tenantStatus !== "active" ? <Tag tone="warn">{r.tenantStatus.replace("_", " ")}</Tag> : null}
                </td>
                <td style={{ textAlign: "right" }}>{inr(r.total)}</td>
                <td style={{ textAlign: "right" }}>{r.daysOverdue}</td>
                <td>{r.action ? <Tag tone={r.action === "suspend" ? "bad" : "warn"}>{ACTION[r.action]}</Tag> : <span className="text-muted">Nothing due ({r.remindersSent} sent)</span>}{!r.hasEmail ? <span className="text-muted"> · no email</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Dialog>
  );
}
