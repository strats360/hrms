import { describe, expect, it } from "vitest";
import { invoiceTaxFor, zatcaQr } from "../src";

describe("invoice tax by country", () => {
  it("keeps India's GST split", () => {
    expect(invoiceTaxFor({ subtotal: 10000, sellerCountry: "IN", buyerCountry: "IN", sellerStateCode: "24", buyerStateCode: "24" })).toMatchObject({ cgst: 900, sgst: 900, igst: 0, total: 11800, lines: [{ label: "CGST 9%" }, { label: "SGST 9%" }] });
    expect(invoiceTaxFor({ subtotal: 10000, sellerCountry: "IN", buyerCountry: "IN", sellerStateCode: "24", buyerStateCode: "27" })).toMatchObject({ igst: 1800, total: 11800, lines: [{ label: "IGST 18%" }] });
  });
  it("charges VAT at home and zero rates exports", () => {
    expect(invoiceTaxFor({ subtotal: 1000, sellerCountry: "AE", buyerCountry: "AE" })).toMatchObject({ total: 1050, lines: [{ label: "VAT 5%", amount: 50 }] });
    expect(invoiceTaxFor({ subtotal: 1000, sellerCountry: "SA", buyerCountry: "SA" })).toMatchObject({ total: 1150, lines: [{ label: "VAT 15%", amount: 150 }] });
    expect(invoiceTaxFor({ subtotal: 1000, sellerCountry: "GB", buyerCountry: "GB" }).total).toBe(1200);
    expect(invoiceTaxFor({ subtotal: 1000, sellerCountry: "AE", buyerCountry: "QA" })).toMatchObject({ total: 1000, lines: [{ label: "VAT 0% (export of services)", amount: 0 }] });
    expect(invoiceTaxFor({ subtotal: 1000, sellerCountry: "IN", buyerCountry: "AE" })).toMatchObject({ total: 1000, lines: [{ label: "IGST 0% (export of services)" }] });
  });
  it("adds nothing where there's no VAT, and rounds to the currency", () => {
    expect(invoiceTaxFor({ subtotal: 1000, sellerCountry: "QA", buyerCountry: "QA" })).toMatchObject({ total: 1000, lines: [] });
    expect(invoiceTaxFor({ subtotal: 333.3333, sellerCountry: "OM", buyerCountry: "OM", decimals: 3 })).toMatchObject({ total: 350, lines: [{ amount: 16.667 }] });
  });
});

describe("ZATCA QR", () => {
  it("matches ZATCA's worked example", () => {
    // the example from ZATCA's e-invoicing guide
    expect(zatcaQr({ sellerName: "Bobs Records", vatNumber: "310122393500003", timestamp: "2022-04-25T15:30:00Z", total: 1000, vat: 150 })).toBe("AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==");
  });
  it("handles Arabic names (lengths are in bytes)", () => {
    const qr = zatcaQr({ sellerName: "شركة سرالكس", vatNumber: "300000000000003", timestamp: "2026-11-01T00:00:00Z", total: 115, vat: 15 });
    const bytes = Uint8Array.from(atob(qr), (c) => c.charCodeAt(0));
    expect(bytes[0]).toBe(1);
    expect(new TextDecoder().decode(bytes.slice(2, 2 + bytes[1]!))).toBe("شركة سرالكس");
  });
});
