import { z } from "zod";

/**
 * TDS on payments to contractors and professionals. Under the Income Tax Act 1961 these are
 * sections 194C and 194J; from tax year 2026-27 the Income Tax Act 2025 moves both into section
 * 393 with the same rates. Confirm thresholds and rates with your tax advisor.
 *
 * - 194C, contract work: 1% to individuals and HUFs, 2% to others. TDS once a single payment is
 *   over ₹30,000 or the year's payments go over ₹1,00,000.
 * - 194J, fees for professional services 10%, technical services 2%, once the year's payments to
 *   the payee go over ₹50,000 (₹30,000 before 1 April 2025).
 * - No PAN: 20% (or the higher rate).
 * When a payment takes the year over a threshold, TDS is also taken on the earlier payments that
 * had none.
 */
export const CONTRACTOR_SECTIONS = {
  "194C": { label: "194C · contract work", rates: { individual: 0.01, company: 0.02 } },
  "194J_professional": { label: "194J · professional fees", rates: { individual: 0.1, company: 0.1 } },
  "194J_technical": { label: "194J · technical services", rates: { individual: 0.02, company: 0.02 } },
} as const;
export type ContractorSection = keyof typeof CONTRACTOR_SECTIONS;
export const CONTRACTOR_SECTION_KEYS = Object.keys(CONTRACTOR_SECTIONS) as [ContractorSection, ...ContractorSection[]];
export const NO_PAN_RATE = 0.2;

/** The section's name for a tax year: 194C or 194J before 2026-27, 393 after. */
export const sectionName = (s: ContractorSection, fy: string) => (fy >= "2026-27" ? `393 (was ${s.slice(0, 4)})` : s.slice(0, 4));

export function contractorTds(o: { section: ContractorSection; kind: "individual" | "company"; amount: number; hasPan: boolean; fy: string; paidThisYear: number; untaxedThisYear: number }) {
  const sec = CONTRACTOR_SECTIONS[o.section];
  const rate = o.hasPan ? sec.rates[o.kind] : Math.max(NO_PAN_RATE, sec.rates[o.kind]);
  const total = o.paidThisYear + o.amount;
  let due: boolean;
  let note: string;
  if (o.section === "194C") {
    due = o.amount > 30000 || total > 100000;
    note = o.amount > 30000 ? "Single payment over ₹30,000" : total > 100000 ? "Year's payments over ₹1,00,000" : "Under ₹30,000, and the year is under ₹1,00,000";
  } else {
    const limit = o.fy >= "2025-26" ? 50000 : 30000;
    due = total > limit;
    note = due ? `Year's payments over ₹${limit.toLocaleString("en-IN")}` : `Year is under ₹${limit.toLocaleString("en-IN")}`;
  }
  if (!due) return { rate: 0, tds: 0, note };
  // crossing a threshold now: catch up the earlier payments that had no TDS
  const catchUp = o.untaxedThisYear > 0 && (o.section !== "194C" || total > 100000) ? o.untaxedThisYear : 0;
  const tds = Math.round((o.amount + catchUp) * rate);
  return { rate, tds, note: `${note}${catchUp ? `, including ₹${Math.round(catchUp).toLocaleString("en-IN")} paid earlier with no TDS` : ""}${o.hasPan ? "" : ". No PAN: 20%"}` };
}

const trimmed = (n: number) => z.string().trim().max(n);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" ? null : v), s.nullable().optional());

export const contractorSchema = z.object({
  name: trimmed(120).pipe(z.string().min(1, "Enter a name")),
  entityId: opt(z.string()),
  pan: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F")),
  kind: z.enum(["individual", "company"]).default("individual"),
  section: z.enum(CONTRACTOR_SECTION_KEYS).default("194C"),
  email: opt(z.string().trim().toLowerCase().email()),
  phone: opt(trimmed(20)),
  bankName: opt(trimmed(120)),
  accountNumber: opt(z.string().trim().regex(/^\d{6,18}$/, "Account number is 6 to 18 digits")),
  ifsc: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must look like HDFC0001234")),
  active: z.boolean().default(true),
});

export const contractorPaymentSchema = z.object({
  contractorId: z.string().min(1),
  invoiceNo: opt(trimmed(40)),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: opt(trimmed(200)),
  gross: z.coerce.number().positive("Amount must be more than zero").max(1e9),
});
