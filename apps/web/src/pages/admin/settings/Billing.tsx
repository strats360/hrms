import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { fmtDate, inr } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Invoice, TenantBilling } from "@/lib/types";
import { Card, CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ErrorState, KV, Loading, Notice } from "@/components/ui/page";
import { InvoiceDialog, InvoiceStatusTag } from "@/components/billing/InvoiceView";

export default function Billing() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["billing"], queryFn: () => api.get<TenantBilling>("/admin/billing") });
  const [view, setView] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const saveEmail = useMutation({
    mutationFn: () => api.patch("/admin/billing/details", { billingEmail: email?.trim() || null }),
    onSuccess: () => {
      toast.success("Billing email saved");
      setEmail(null);
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
  });
  const columns = useMemo<ColumnDef<Invoice, any>[]>(
    () => [
      { id: "number", header: "Invoice", accessorFn: (i) => i.number, cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { id: "period", header: "Period", accessorFn: (i) => i.period, cell: ({ row: { original: i } }) => i.periodLabel },
      { id: "seats", header: "Seats", accessorFn: (i) => i.seats, meta: { align: "right" } },
      { id: "subtotal", header: "Subtotal", accessorFn: (i) => Number(i.subtotal), meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "gst", header: "GST 18%", accessorFn: (i) => Number(i.cgst) + Number(i.sgst) + Number(i.igst), meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "total", header: "Total", accessorFn: (i) => Number(i.total), meta: { align: "right" }, cell: ({ getValue }) => <span className="font-medium">{inr(getValue<number>())}</span> },
      { id: "status", header: "Status", accessorFn: (i) => i.displayStatus, cell: ({ row: { original: i } }) => <div className="flex items-center gap-1.5"><InvoiceStatusTag status={i.displayStatus} /><span className="text-muted text-[12px]">{i.status === "paid" && i.paidOn ? fmtDate(i.paidOn, false) : `due ${fmtDate(i.dueOn, false)}`}</span></div> },
    ],
    [],
  );
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const cap = d.plan.maxEmployees;
  const pct = cap ? Math.min(100, Math.round((d.seats.active / cap) * 100)) : null;
  return (
    <div className="flex flex-col gap-4">
      {d.status === "past_due" || d.overdue > 0 ? <Notice tone="bad">{inr(d.overdue)} is overdue. Please pay to avoid your account being suspended.</Notice> : null}
      {d.status === "trial" ? <Notice tone="sel">You're on a free trial{d.trialEndsAt ? ` until ${fmtDate(d.trialEndsAt.slice(0, 10))}` : ""}. Billing starts when you pick a plan.</Notice> : null}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))" }}>
        <StatCard label="Plan" value={d.plan.name} meta={d.plan.price ? `${inr(d.plan.price)} / employee / month${d.plan.custom ? " (contract rate)" : ""} · billed monthly` : "No charge"} />
        <Card className="!gap-1" style={{ padding: "14px 16px" }}>
          <div className="card-kicker">Seats used</div>
          <div className="stat-value">{d.seats.active}</div>
          {pct !== null ? (
            <div className="h-1.5 overflow-hidden rounded-[var(--radius-md)]" style={{ background: "var(--tint-2)" }}>
              <div className="h-full" style={{ width: `${pct}%`, background: pct > 90 ? "var(--warn)" : "var(--color-accent)" }} />
            </div>
          ) : null}
          <div className="card-meta">
            {cap ? `of ${cap.toLocaleString("en-IN")} on this plan · ` : ""}
            {d.seats.billable > d.seats.active ? `billed at the plan minimum of ${d.seats.billable}` : "active employees are billed"}
          </div>
        </Card>
        <StatCard label="Next invoice" value={d.nextInvoice ? inr(d.nextInvoice.total) : "—"} meta={d.nextInvoice ? `${fmtDate(d.nextInvoice.date)} · ${inr(d.nextInvoice.subtotal)} + 18% GST` : "Nothing due"} />
        <StatCard label="Payment method" value={d.billing.paymentMethod?.split(" · ")[0] ?? "Bank transfer"} meta={d.billing.paymentMethod?.split(" · ").slice(1).join(" · ") || "UPI or NEFT against each invoice"} />
      </div>
      <TableCard>
        <CardHeader title="Invoices" sub="Download any invoice as a PDF for your records and GST input credit" />
        <DataTable data={d.invoices} columns={columns} getRowId={(i) => i.id} onRowClick={(i) => setView(i.id)} rowActions={(i) => [{ label: "View / download PDF", onSelect: () => setView(i.id) }]} empty="No invoices yet" columnToggle={false} />
      </TableCard>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="!gap-3" style={{ padding: 18 }}>
          <CardHeader title="Billing details" sub="From your organization settings" />
          <div className="grid grid-cols-2 gap-3 text-[13.5px]">
            <KV label="Legal name">{d.billing.legalName}</KV>
            <KV label="GSTIN">{d.billing.gstin}</KV>
            <KV label="Place of supply">{d.billing.state}</KV>
            <KV label="Address" span>{d.billing.address}</KV>
          </div>
          {email === null ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
              <KV label="Invoices are emailed to">{d.billing.billingEmail}</KV>
              {can("billing", "edit") ? (
                <Button size="sm" onClick={() => setEmail(d.billing.billingEmail ?? "")}>
                  Change
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <Field label="Billing email" className="flex-1">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </Field>
              <Button onClick={() => setEmail(null)}>Cancel</Button>
              <Button variant="primary" loading={saveEmail.isPending} onClick={() => saveEmail.mutate()}>
                Save
              </Button>
            </div>
          )}
        </Card>
        <Card className="!gap-2" style={{ padding: 18 }}>
          <CardHeader title="Usage this month" />
          <div className="flex flex-col gap-1.5 text-[13.5px]">
            <Row label="Active employees (billable)" value={d.seats.active} />
            <Row label="Payslips generated" value={d.usage.payslips} />
            <Row label="Bank files exported" value={d.usage.bankFiles} />
            <Row label="Admin users" value={d.plan.includedAdmins ? `${d.admins} of ${d.plan.includedAdmins} included` : d.admins} />
          </div>
          {d.plan.features.length ? <div className="text-muted mt-1 text-[12.5px]">Your plan includes: {d.plan.features.join(" · ")}</div> : null}
          <div className="text-muted text-[12.5px]">To change plan, contact billing@strats360people.in.</div>
        </Card>
      </div>
      <InvoiceDialog path={view ? `/admin/billing/invoices/${view}` : null} onClose={() => setView(null)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
