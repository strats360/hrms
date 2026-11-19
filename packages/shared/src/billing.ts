/** SaaS billing: GST on subscription invoices and the dunning schedule. */

/** GST state codes (first two digits of a GSTIN). */
export const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01", "Himachal Pradesh": "02", Punjab: "03", Chandigarh: "04", Uttarakhand: "05", Haryana: "06", Delhi: "07", Rajasthan: "08",
  "Uttar Pradesh": "09", Bihar: "10", Sikkim: "11", "Arunachal Pradesh": "12", Nagaland: "13", Manipur: "14", Mizoram: "15", Tripura: "16", Meghalaya: "17",
  Assam: "18", "West Bengal": "19", Jharkhand: "20", Odisha: "21", Chhattisgarh: "22", "Madhya Pradesh": "23", Gujarat: "24", "Dadra and Nagar Haveli and Daman and Diu": "26",
  Maharashtra: "27", Karnataka: "29", Goa: "30", Lakshadweep: "31", Kerala: "32", "Tamil Nadu": "33", Puducherry: "34", "Andaman and Nicobar Islands": "35",
  Telangana: "36", "Andhra Pradesh": "37", Ladakh: "38",
};
export const STATE_BY_CODE = Object.fromEntries(Object.entries(GST_STATE_CODES).map(([k, v]) => [v, k]));

/** State code from the GSTIN when there is one, otherwise from the state name. */
export function stateCodeOf(gstin: string | null | undefined, state: string | null | undefined): string | null {
  if (gstin && /^\d{2}/.test(gstin)) return gstin.slice(0, 2);
  if (!state) return null;
  const hit = Object.entries(GST_STATE_CODES).find(([k]) => k.toLowerCase() === state.trim().toLowerCase());
  return hit ? hit[1] : null;
}

export const GST_RATE = 0.18;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Same state as the seller: CGST 9% + SGST 9%. Another state (or unknown place of supply): IGST 18%.
 */
export function invoiceTax(subtotal: number, sellerStateCode: string | null, buyerStateCode: string | null) {
  const intra = !!sellerStateCode && sellerStateCode === buyerStateCode;
  const tax = r2(subtotal * GST_RATE);
  const cgst = intra ? r2(tax / 2) : 0;
  const sgst = intra ? r2(tax - cgst) : 0;
  const igst = intra ? 0 : tax;
  return { intra, cgst, sgst, igst, total: r2(subtotal + cgst + sgst + igst) };
}

/** Billable seats: active employees, but at least the plan's minimum. */
export const billableSeats = (activeEmployees: number, minSeats = 0) => Math.max(activeEmployees, minSeats);

export interface DunningPolicy {
  reminderDays: number[];
  pastDueAfter: number;
  suspendAfter: number;
}
export const DEFAULT_DUNNING: DunningPolicy = { reminderDays: [1, 7, 15], pastDueAfter: 15, suspendAfter: 45 };

/** What should happen to an overdue invoice today. */
export function dunningStage(daysOverdue: number, remindersSent: number, p: DunningPolicy = DEFAULT_DUNNING) {
  if (daysOverdue <= 0) return { remind: false, pastDue: false, suspend: false };
  const due = p.reminderDays.filter((d) => daysOverdue >= d).length;
  return { remind: due > remindersSent, pastDue: daysOverdue >= p.pastDueAfter, suspend: daysOverdue >= p.suspendAfter };
}

// ---------------------------------------------------------------------------
// Tax on subscription invoices, by the selling entity's country (docs/MULTI_COUNTRY.md, phase 3)
// ---------------------------------------------------------------------------

export interface InvoiceTaxLine {
  code: string;
  label: string;
  rate: number;
  amount: number;
}

/**
 * Sales tax the seller charges at home. A buyer in another country is zero rated (export of
 * services), shown as a 0% line so the invoice says why. Rates are a starting point: confirm them,
 * and the export treatment, with a tax advisor in each country.
 */
export const SALES_TAX: Record<string, { label: string; rate: number; taxIdLabel: string } | null> = {
  IN: { label: "GST", rate: GST_RATE, taxIdLabel: "GSTIN" },
  AE: { label: "VAT", rate: 0.05, taxIdLabel: "TRN" },
  SA: { label: "VAT", rate: 0.15, taxIdLabel: "VAT number" },
  OM: { label: "VAT", rate: 0.05, taxIdLabel: "VAT number" },
  BH: { label: "VAT", rate: 0.1, taxIdLabel: "VAT number" },
  GB: { label: "VAT", rate: 0.2, taxIdLabel: "VAT number" },
  QA: null, // no VAT
  KW: null, // no VAT
  US: null, // sales tax on SaaS depends on the state; not charged yet
  CA: null, // GST, HST or PST depend on the customer's province; not charged yet
};

export const taxIdLabel = (country: string) => SALES_TAX[country]?.taxIdLabel ?? "Tax number";

export interface InvoiceTaxInput {
  subtotal: number;
  sellerCountry: string;
  buyerCountry: string | null;
  /** India only: GST state codes decide CGST and SGST against IGST. */
  sellerStateCode?: string | null;
  buyerStateCode?: string | null;
  /** Currency minor units (2 for INR and AED, 3 for KWD and OMR). */
  decimals?: number;
}

/** Tax lines and total for one invoice. India keeps its CGST, SGST and IGST split. */
export function invoiceTaxFor(i: InvoiceTaxInput) {
  const f = 10 ** (i.decimals ?? 2);
  const rd = (n: number) => Math.round(n * f) / f;
  const sub = rd(i.subtotal);
  const buyer = i.buyerCountry ?? i.sellerCountry;
  if (i.sellerCountry === "IN") {
    if (buyer !== "IN") return { lines: [{ code: "igst", label: "IGST 0% (export of services)", rate: 0, amount: 0 }], cgst: 0, sgst: 0, igst: 0, total: sub };
    const g = invoiceTax(sub, i.sellerStateCode ?? null, i.buyerStateCode ?? null);
    const lines: InvoiceTaxLine[] = g.intra
      ? [
          { code: "cgst", label: "CGST 9%", rate: 0.09, amount: g.cgst },
          { code: "sgst", label: "SGST 9%", rate: 0.09, amount: g.sgst },
        ]
      : [{ code: "igst", label: "IGST 18%", rate: 0.18, amount: g.igst }];
    return { lines, cgst: g.cgst, sgst: g.sgst, igst: g.igst, total: g.total };
  }
  const t = SALES_TAX[i.sellerCountry];
  if (!t) return { lines: [] as InvoiceTaxLine[], cgst: 0, sgst: 0, igst: 0, total: sub };
  const pct = `${Math.round(t.rate * 1000) / 10}%`;
  if (buyer !== i.sellerCountry) return { lines: [{ code: "vat", label: `${t.label} 0% (export of services)`, rate: 0, amount: 0 }], cgst: 0, sgst: 0, igst: 0, total: sub };
  const amount = rd(sub * t.rate);
  return { lines: [{ code: "vat", label: `${t.label} ${pct}`, rate: t.rate, amount }], cgst: 0, sgst: 0, igst: 0, total: rd(sub + amount) };
}

/**
 * The QR code a Saudi tax invoice must carry (ZATCA e-invoicing, phase 1 "generation"):
 * TLV fields for seller name, VAT number, time stamp, total with VAT and the VAT amount, base64.
 * Phase 2 ("integration": clearing invoices through ZATCA's Fatoora platform) is a later step.
 */
export function zatcaQr(f: { sellerName: string; vatNumber: string; timestamp: string; total: number; vat: number }): string {
  const enc = new TextEncoder();
  const fields = [f.sellerName, f.vatNumber, f.timestamp, f.total.toFixed(2), f.vat.toFixed(2)].map((v, i) => {
    const bytes = enc.encode(v);
    if (bytes.length > 255) throw new Error("ZATCA QR fields must be 255 bytes or less");
    return Uint8Array.from([i + 1, bytes.length, ...bytes]);
  });
  const all = new Uint8Array(fields.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of fields) {
    all.set(b, o);
    o += b.length;
  }
  let s = "";
  for (const b of all) s += String.fromCharCode(b);
  return btoa(s);
}
