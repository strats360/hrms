import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { renderSVG } from "uqr";
import { fmtDate, fmtMoney, rupeesInWords, taxIdLabel, zatcaQr } from "@hrms/shared";
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
  const cur = inv.currency ?? "INR";
  const money = (n: number) => fmtMoney(n, { decimals: cur === "INR" ? 2 : undefined, currency: cur });
  const sellerCountry = inv.seller.country ?? "IN";
  const india = sellerCountry === "IN";
  // GST split for India and older invoices; otherwise the lines stored on the invoice
  const taxLines = inv.taxLines?.length ? inv.taxLines : intra ? [{ label: "CGST 9%", amount: inv.cgst }, { label: "SGST 9%", amount: inv.sgst }] : [{ label: "IGST 18%", amount: inv.igst }];
  const vat = taxLines.reduce((n, l) => n + l.amount, 0);
  // Saudi tax invoices carry ZATCA's QR code (e-invoicing phase 1)
  const qr = sellerCountry === "SA" && inv.seller.taxNumber ? renderSVG(zatcaQr({ sellerName: inv.seller.legalName ?? inv.seller.name, vatNumber: inv.seller.taxNumber, timestamp: `${inv.issuedOn}T00:00:00Z`, total: inv.total, vat }), { border: 1 }) : null;
  return (
    <div className="flex flex-col gap-4 text-[13px]" style={{ color: "var(--color-text)" }}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-divider)] pb-4">
        <div>
          <div className="text-[18px] font-semibold">{inv.seller.legalName ?? inv.seller.name}</div>
          <div className="text-muted max-w-[340px]">{inv.seller.address}</div>
          <div className="text-muted">
            {india ? `GSTIN ${inv.seller.gstin ?? "—"}` : `${taxIdLabel(sellerCountry)} ${inv.seller.taxNumber ?? "—"}`}
            {india && inv.entity.pan ? ` · PAN ${inv.entity.pan}` : ""}
          </div>
        </div>
        <div className="text-end">
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
          <div className="text-muted">{(inv.buyer.country ?? "IN") === "IN" ? `GSTIN ${inv.buyer.gstin ?? "Unregistered"}` : `${taxIdLabel(inv.buyer.country!)} ${inv.buyer.taxNumber ?? "not given"}`}</div>
        </div>
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.08em]">Place of supply</div>
          <div>
            {(inv.buyer.country ?? "IN") === "IN" ? (inv.buyer.state ?? "—") : inv.buyer.country}
            {(inv.buyer.country ?? "IN") === "IN" && inv.buyer.stateCode ? ` (${inv.buyer.stateCode})` : ""}
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
              <td style={{ textAlign: "right" }} className="num">{money(l.rate)}</td>
              <td style={{ textAlign: "right" }} className="num">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ms-auto flex w-full max-w-[320px] flex-col gap-1">
        <Row label="Taxable value" value={money(inv.subtotal)} />
        {taxLines.map((l) => (
          <Row key={l.label} label={l.label} value={money(l.amount)} />
        ))}
        <div className="mt-1 flex justify-between border-t border-[var(--color-divider)] pt-2 text-[15px] font-semibold">
          <span>Total</span>
          <span className="num">{money(inv.total)}</span>
        </div>
        {cur === "INR" ? <div className="text-muted text-end text-[12px]">{rupeesInWords(Math.round(inv.total))}</div> : null}
        {qr ? <div className="ms-auto mt-2 w-[110px]" aria-label="ZATCA QR code" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
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
        <div className="text-muted sm:text-end">
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
              Pay {fmtMoney(q.data.total)} now
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
