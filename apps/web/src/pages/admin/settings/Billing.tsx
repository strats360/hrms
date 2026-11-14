import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { fmtDate, inr } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { openCheckout } from "@/lib/cashfree";
import { useSession } from "@/lib/session";
import type { Invoice, TenantBilling } from "@/lib/types";
import { Card, CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ErrorState, KV, Loading, Notice } from "@/components/ui/page";
import { InvoiceDialog, InvoiceStatusTag } from "@/components/billing/InvoiceView";
import { AutopayCard } from "@/components/billing/AutopayCard";
import { confirmAction } from "@/components/ui/confirm";

export default function Billing() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["billing"], queryFn: () => api.get<TenantBilling>("/admin/billing") });
  const [view, setView] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [paying, setPaying] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const readOnly = !!useSession().tenant?.support;

  const pay = async (invoiceId: string) => {
    // an autopay debit already lined up for this invoice is withdrawn once the online payment goes through
    const next = qc.getQueryData<{ nextCharge: { invoice: string; scheduledFor: string } | null }>(["billing", "autopay"])?.nextCharge;
    const number = q.data?.invoices.find((i) => i.id === invoiceId)?.number;
    if (next && number && next.invoice === number && !(await confirmAction({ title: "Pay now instead of autopay?", body: `Autopay will debit this invoice on ${fmtDate(next.scheduledFor.slice(0, 10))}. If you pay now, we'll cancel that debit, as long as it hasn't reached your bank yet.`, confirmLabel: "Pay now" }))) return;
    setPaying(invoiceId);
    try {
      const r = await api.post<{ orderId: string; paymentSessionId: string; mode: "sandbox" | "production" }>(`/admin/billing/invoices/${invoiceId}/pay`);
      await openCheckout(r.paymentSessionId, r.mode);
    } catch (e) {
      toast.error(errorMessage(e));
      setPaying(null);
    }
  };

  // back from Cashfree: ?order_id=... -> confirm with the server (it asks Cashfree)
  const orderId = params.get("order_id");
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!orderId || checked.current === orderId) return;
    checked.current = orderId;
    setConfirming(true);
    let tries = 0;
    const clear = () => {
      const p = new URLSearchParams(params);
      p.delete("order_id");
      setParams(p, { replace: true });
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ["billing"] });
    };
    const check = async () => {
      try {
        const r = await api.get<{ status: string; invoice: { number: string; status: string }; failureReason: string | null }>(`/admin/billing/payments/${encodeURIComponent(orderId)}`);
        if (r.status === "paid" || r.invoice.status === "paid") {
          toast.success(`Payment received for ${r.invoice.number}. Thank you.`);
          return clear();
        }
        if (r.status === "failed" || r.status === "dropped" || r.status === "expired") {
          toast.error(r.status === "dropped" ? "Payment was cancelled. Nothing was charged." : `Payment didn't go through${r.failureReason ? `: ${r.failureReason}` : ""}. You can try again.`);
          return clear();
        }
      } catch (e) {
        toast.error(errorMessage(e));
        return clear();
      }
      // UPI and netbanking can take a few seconds to confirm
      if (++tries < 8) setTimeout(check, 2500);
      else {
        toast.message("We're waiting for the bank to confirm. The invoice updates automatically once it does.");
        clear();
      }
    };
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
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
  const payLink = params.get("pay");
  useEffect(() => {
    if (payLink) {
      setView(payLink);
      const p = new URLSearchParams(params);
      p.delete("pay");
      setParams(p, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payLink]);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const cap = d.plan.maxEmployees;
  const pct = cap ? Math.min(100, Math.round((d.seats.active / cap) * 100)) : null;
  return (
    <div className="flex flex-col gap-4">
      {confirming ? <Notice tone="sel">Confirming your payment with the bank…</Notice> : null}
      {d.status === "past_due" || d.overdue > 0 ? (
        <Notice tone="bad">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{inr(d.overdue)} is overdue. Please pay to avoid your account being suspended.</span>
            {d.payOnline && !readOnly ? (
              <Button size="sm" loading={!!paying} onClick={() => pay(d.invoices.find((i) => i.displayStatus === "overdue")!.id)}>
                Pay now
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}
      {d.payOnline && !readOnly && d.invoices.some((i) => i.status === "issued") && !/^(\+?91)?[\s-]*[6-9]\d{4}[\s-]?\d{5}$/.test((d.contactPhone ?? "").replace(/\s+/g, " ").trim()) ? (
        <Notice tone="warn">
          Online payment needs your company's mobile number. <Link to="/settings">Add it in Organization settings</Link>.
        </Notice>
      ) : null}
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
        <StatCard label="Payment method" value={d.billing.paymentMethod?.split(" · ")[0] ?? (d.payOnline ? "Pay online" : "Bank transfer")} meta={d.billing.paymentMethod?.split(" · ").slice(1).join(" · ") || (d.payOnline ? "UPI, cards or netbanking through Cashfree" : "UPI or NEFT against each invoice")} />
      </div>
      <AutopayCard />
      <TableCard>
        <CardHeader title="Invoices" sub="Download any invoice as a PDF for your records and GST input credit" />
        <DataTable
          data={d.invoices}
          columns={[
            ...columns,
            ...(d.payOnline && !readOnly
              ? [
                  {
                    id: "pay",
                    header: "",
                    enableSorting: false,
                    cell: ({ row: { original: i } }: { row: { original: Invoice } }) =>
                      i.status === "issued" ? (
                        <Button size="sm" variant="primary" loading={paying === i.id} onClick={(e) => (e.stopPropagation(), pay(i.id))}>
                          Pay now
                        </Button>
                      ) : null,
                  } as ColumnDef<Invoice, any>,
                ]
              : []),
          ]}
          getRowId={(i) => i.id}
          onRowClick={(i) => setView(i.id)}
          rowActions={(i) => [{ label: "View / download PDF", onSelect: () => setView(i.id) }, ...(d.payOnline && i.status === "issued" && !readOnly ? [{ label: "Pay online", onSelect: () => pay(i.id) }] : [])]}
          empty="No invoices yet"
          columnToggle={false}
        />
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
      <InvoiceDialog path={view ? `/admin/billing/invoices/${view}` : null} onClose={() => setView(null)} onPay={readOnly ? undefined : (id) => (setView(null), pay(id))} />
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
