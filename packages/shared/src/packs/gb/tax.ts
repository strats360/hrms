import { RUK_BANDS, SCOTTISH_BANDS, type Band } from "./rules";

export interface TaxCode {
  raw: string;
  /** Cumulative, or week 1 / month 1 (each month on its own). */
  cumulative: boolean;
  region: "rUK" | "scotland" | "wales";
  /** Annual tax free pay; negative for K codes (they add to pay). */
  allowance: number;
  /** A flat rate on everything (BR, D0, D1, D2), or no tax at all (NT). */
  flat: number | null;
  noTax: boolean;
}

export function parseTaxCode(code: string | null | undefined): TaxCode {
  const raw = (code ?? "1257L").toUpperCase().replace(/\s+/g, " ").trim();
  const cumulative = !/ ?(W1|M1|X)$/.test(raw);
  let c = raw.replace(/ ?(W1|M1|X)$/, "");
  let region: TaxCode["region"] = "rUK";
  if (c.startsWith("S")) [region, c] = ["scotland", c.slice(1)];
  else if (c.startsWith("C")) [region, c] = ["wales", c.slice(1)];
  const bands = region === "scotland" ? SCOTTISH_BANDS : RUK_BANDS;
  const at = (i: number) => bands[Math.min(i, bands.length - 1)]!.rate;
  if (c === "NT") return { raw, cumulative, region, allowance: 0, flat: null, noTax: true };
  if (c === "BR") return { raw, cumulative, region, allowance: 0, flat: region === "scotland" ? 0.2 : at(0), noTax: false };
  if (c === "D0") return { raw, cumulative, region, allowance: 0, flat: region === "scotland" ? 0.21 : at(1), noTax: false };
  if (c === "D1") return { raw, cumulative, region, allowance: 0, flat: region === "scotland" ? 0.42 : at(2), noTax: false };
  if (c === "D2") return { raw, cumulative, region, allowance: 0, flat: region === "scotland" ? 0.45 : at(2), noTax: false };
  if (c === "0T") return { raw, cumulative, region, allowance: 0, flat: null, noTax: false };
  const k = /^K(\d+)$/.exec(c);
  if (k) return { raw, cumulative, region, allowance: -(Number(k[1]) * 10), flat: null, noTax: false };
  const n = /^(\d+)[LMNT]$/.exec(c);
  // the number times ten, plus 9, is the year's tax free pay
  return { raw, cumulative, region, allowance: n ? Number(n[1]) * 10 + 9 : 12579, flat: null, noTax: false };
}

/** Tax on taxable pay using bands scaled to the periods so far (n of 12). */
function bandTax(pay: number, bands: Band[], n: number): number {
  let tax = 0;
  let lower = 0;
  for (const b of bands) {
    const upper = b.upTo === Infinity ? Infinity : (b.upTo * n) / 12;
    if (pay > lower) tax += (Math.min(pay, upper) - lower) * b.rate;
    lower = upper;
  }
  return tax;
}

/**
 * PAYE for one monthly payslip, the way HMRC's exact percentage method works it out:
 * tax due to date on pay to date, less tax already paid. K codes can't take more than half
 * of this month's pay. Month 1 codes work out each month on its own.
 */
export function payeThisMonth(o: { code: TaxCode; taxMonth: number; payThisMonth: number; payToDateBefore: number; taxToDateBefore: number }) {
  const { code } = o;
  if (code.noTax) return { tax: 0, taxablePayToDate: 0, taxDueToDate: 0 };
  const n = code.cumulative ? o.taxMonth : 1;
  const pay = code.cumulative ? o.payToDateBefore + o.payThisMonth : o.payThisMonth;
  const paid = code.cumulative ? o.taxToDateBefore : 0;
  const bands = code.region === "scotland" ? SCOTTISH_BANDS : RUK_BANDS;
  let due: number;
  let taxable: number;
  if (code.flat !== null) {
    taxable = Math.floor(pay);
    due = taxable * code.flat;
  } else {
    // free pay (or the K addition) to date, then whole pounds of taxable pay
    const free = (code.allowance * n) / 12;
    taxable = Math.max(0, Math.floor(pay - free));
    due = bandTax(taxable, bands, n);
  }
  due = Math.floor(due * 100) / 100;
  let tax = Math.round((due - paid) * 100) / 100;
  // the overriding limit for K codes: at most half of this month's pay
  if (code.allowance < 0 && tax > o.payThisMonth / 2) tax = Math.floor((o.payThisMonth / 2) * 100) / 100;
  return { tax, taxablePayToDate: taxable, taxDueToDate: due };
}
