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
