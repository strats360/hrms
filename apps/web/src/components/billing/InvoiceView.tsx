import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { fmtDate, inr, rupeesInWords } from "@hrms/shared";
import { api } from "@/lib/api";
import type { InvoiceDetail, InvoiceStatus } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorState, Loading } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";

const TONE: Record<InvoiceStatus, Tone> = { issued: "warn", paid: "ok", void: "neutral", overdue: "bad" };
const LABEL: Record<InvoiceStatus, string> = { issued: "Due", paid: "Paid", void: "Void", overdue: "Overdue" };
const fmtIST = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });

export function InvoiceStatusTag({ status }: { status: InvoiceStatus }) {
  return <Tag tone={TONE[status]}>{LABEL[status]}</Tag>;
}

/** Tax invoice layout (prints on A4 via the browser's Save as PDF). */
export function InvoiceView({ inv }: { inv: InvoiceDetail }) {
  const intra = inv.cgst > 0 || inv.sgst > 0;
  return (
    <div className="flex flex-col gap-4 text-[13px]" style={{ color: "var(--color-text)" }}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-divider)] pb-4">
        <div>
          <div className="text-[18px] font-semibold">{inv.seller.legalName ?? inv.seller.name}</div>
          <div className="text-muted max-w-[340px]">{inv.seller.address}</div>
          <div className="text-muted">
            GSTIN {inv.seller.gstin ?? "—"}
            {inv.entity.pan ? ` · PAN ${inv.entity.pan}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[20px] font-semibold tracking-wide">TAX INVOICE</div>
          <div className="font-medium">{inv.number}</div>
          <div className="text-muted">Issued {fmtDate(inv.issuedOn)} · due {fmtDate(inv.dueOn)}</div>
          <div className="mt-1">
            <InvoiceStatusTag status={inv.displayStatus} />
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.08em]">Billed to</div>
          <div className="font-medium">{inv.buyer.legalName ?? inv.buyer.name}</div>
          <div className="text-muted">{inv.buyer.address}</div>
          <div className="text-muted">GSTIN {inv.buyer.gstin ?? "Unregistered"}</div>
        </div>
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.08em]">Place of supply</div>
          <div>
            {inv.buyer.state ?? "—"}
            {inv.buyer.stateCode ? ` (${inv.buyer.stateCode})` : ""}
          </div>
          <div className="text-muted">Period: {inv.periodLabel}</div>
          <div className="text-muted">Reverse charge: No</div>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Description</th>
            <th>SAC</th>
            <th style={{ textAlign: "right" }}>Qty</th>
            <th style={{ textAlign: "right" }}>Rate</th>
            <th style={{ textAlign: "right" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.description}</td>
              <td>{l.sac}</td>
              <td style={{ textAlign: "right" }} className="num">{l.quantity}</td>
              <td style={{ textAlign: "right" }} className="num">{inr(l.rate, { decimals: 2 })}</td>
              <td style={{ textAlign: "right" }} className="num">{inr(l.amount, { decimals: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto flex w-full max-w-[320px] flex-col gap-1">
        <Row label="Taxable value" value={inr(inv.subtotal, { decimals: 2 })} />
        {intra ? (
          <>
            <Row label="CGST 9%" value={inr(inv.cgst, { decimals: 2 })} />
            <Row label="SGST 9%" value={inr(inv.sgst, { decimals: 2 })} />
          </>
        ) : (
          <Row label="IGST 18%" value={inr(inv.igst, { decimals: 2 })} />
        )}
        <div className="mt-1 flex justify-between border-t border-[var(--color-divider)] pt-2 text-[15px] font-semibold">
          <span>Total</span>
          <span className="num">{inr(inv.total, { decimals: 2 })}</span>
        </div>
        <div className="text-muted text-right text-[12px]">{rupeesInWords(Math.round(inv.total))}</div>
      </div>
      <div className="grid gap-4 border-t border-[var(--color-divider)] pt-3 sm:grid-cols-2">
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.08em]">Payment</div>
          {inv.status === "paid" ? (
            <div>
              Paid {inv.paidOn ? fmtDate(inv.paidOn) : ""}
              {inv.paymentMethod ? ` by ${inv.paymentMethod.toUpperCase()}` : ""}
              {inv.paymentReference ? ` · ${inv.paymentReference}` : ""}
            </div>
          ) : (
            <>
              {inv.entity.upiId ? <div>UPI: {inv.entity.upiId}</div> : null}
              {inv.entity.bankDetails ? <div>{inv.entity.bankDetails}</div> : null}
              <div className="text-muted">Quote {inv.number} as the reference.</div>
            </>
          )}
        </div>
        <div className="text-muted sm:text-right">
          This is a computer-generated invoice and needs no signature.
          {inv.entity.email ? <div>Billing questions: {inv.entity.email}</div> : null}
        </div>
      </div>
      {inv.status === "void" ? <div className="text-[13px]" style={{ color: "var(--bad)" }}>Void: {inv.voidReason}</div> : null}
      {inv.onlinePayments?.length ? (
        <div className="no-print border-t border-[var(--color-divider)] pt-3 text-[12.5px]" data-print="hide">
          <div className="text-muted mb-1 text-[11px] uppercase tracking-[0.08em]">Online payments and autopay (Cashfree)</div>
          {inv.onlinePayments.map((p) => (
            <div key={p.id} className="flex flex-wrap justify-between gap-2 py-0.5">
              <span>
                {new Date(p.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })} · {p.orderId}
              </span>
              <span>
                {p.status === "paid" ? `Paid by ${p.method ?? "online"}${p.bankReference ? ` · ${p.bankReference}` : ""}` : p.status === "created" ? (p.gateway === "cashfree_autopay" ? `Autopay debit scheduled${p.scheduledFor ? ` for ${fmtIST(p.scheduledFor)}` : ""}` : "Checkout open") : p.retryAt ? `Failed${p.failureReason ? `: ${p.failureReason}` : ""}. Retry on ${fmtIST(p.retryAt)}` : `${p.status[0]!.toUpperCase()}${p.status.slice(1)}${p.failureReason ? `: ${p.failureReason}` : ""}`}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

/** Loads an invoice (platform or tenant endpoint) and shows it with a print button. */
export function InvoiceDialog({ path, onClose, onPay }: { path: string | null; onClose: () => void; onPay?: (id: string) => void }) {
  const q = useQuery({ queryKey: ["invoice", path], queryFn: () => api.get<InvoiceDetail>(path!), enabled: !!path });
  return (
    <Dialog
      open={!!path}
      onOpenChange={(v) => !v && onClose()}
      title={q.data ? `Invoice ${q.data.number}` : "Invoice"}
      width={820}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant={onPay && q.data?.payOnline ? "secondary" : "primary"} disabled={!q.data} onClick={() => window.print()}>
            <Printer size={15} /> Download PDF
          </Button>
          {onPay && q.data?.payOnline ? (
            <Button variant="primary" onClick={() => onPay(q.data!.id)}>
              Pay {inr(q.data.total)} now
            </Button>
          ) : null}
        </>
      }
    >
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorState error={q.error} /> : null}
      {q.data ? (
        <div id="invoice-print">
          <InvoiceView inv={q.data} />
        </div>
      ) : null}
    </Dialog>
  );
}
