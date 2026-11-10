import { describe, expect, it } from "vitest";
import { buildBankFile, DEFAULT_EXPORT_LAYOUT, formatExportDate, type BankFileLine, type ExportLayout } from "../src/payments";
import { exportLayoutSchema } from "../src/schemas";

const debit = { accountNumber: "50200012345678", ifsc: "HDFC0000123" };
const lines: BankFileLine[] = [
  { reference: "SAL-1", employeeCode: "STL-0001", beneficiaryName: "Priya Vaghela", accountNumber: "1234567890", ifsc: "sbin0001234", amount: 85000, narration: "Salary Nov 2026", email: "p@x.in", bankName: "SBI", pan: "ABCDE1234F" },
  { reference: "SAL-2", employeeCode: "STL-0002", beneficiaryName: "O'Brien, Ravi", accountNumber: "9876543210", ifsc: "HDFC0000999", amount: 250000.5, narration: "Salary Nov 2026", bankName: "HDFC" },
];

describe("custom bank file layout", () => {
  it("formats dates", () => {
    expect(formatExportDate("2026-11-30", "DD/MM/YYYY")).toBe("30/11/2026");
    expect(formatExportDate("2026-11-30", "DDMMYYYY")).toBe("30112026");
    expect(formatExportDate("2026-11-30", "YYYY-MM-DD")).toBe("2026-11-30");
    expect(formatExportDate("2026-11-30", "DD-MM-YYYY")).toBe("30-11-2026");
  });

  it("writes the chosen columns in order, as CSV with a header", () => {
    const f = buildBankFile("custom", debit, "2026-11-30", lines);
    expect(f.ext).toBe("csv");
    const rows = f.body.replace(/^﻿/, "").trim().split("\r\n");
    expect(rows[0]).toBe("Employee ID,Beneficiary name,Bank,Account number,IFSC,Amount,Payment reference");
    expect(rows[1]).toBe("STL-0001,PRIYA VAGHELA,SBI,1234567890,SBIN0001234,85000.00,SAL-1");
    // bank-safe names drop the comma and apostrophe
    expect(rows[2]).toBe("STL-0002,O BRIEN RAVI,HDFC,9876543210,HDFC0000999,250000.50,SAL-2");
  });

  it("supports pipe files without a header, mode and dates", () => {
    const layout: ExportLayout = { columns: ["mode", "debit_account", "account_number", "amount", "payment_date", "pan"], fileType: "pipe", dateFormat: "DDMMYYYY", header: false, bankSafe: false };
    const f = buildBankFile("custom", debit, "2026-11-30", lines, layout);
    expect(f.ext).toBe("txt");
    expect(f.body.trim().split("\r\n")).toEqual(["NEFT|50200012345678|1234567890|85000.00|30112026|ABCDE1234F", "INTERNAL|50200012345678|9876543210|250000.50|30112026|"]);
  });

  it("hands Excel back as a table", () => {
    const f = buildBankFile("custom", debit, "2026-11-30", lines, { ...DEFAULT_EXPORT_LAYOUT, fileType: "xlsx" });
    expect(f.ext).toBe("xlsx");
    expect(f.table!.rows[0]).toContain(85000);
  });

  it("needs the account number and amount, each column once", () => {
    expect(exportLayoutSchema.safeParse(DEFAULT_EXPORT_LAYOUT).success).toBe(true);
    expect(exportLayoutSchema.safeParse({ ...DEFAULT_EXPORT_LAYOUT, columns: ["employee_code", "amount"] }).success).toBe(false);
    expect(exportLayoutSchema.safeParse({ ...DEFAULT_EXPORT_LAYOUT, columns: ["account_number", "amount", "amount"] }).success).toBe(false);
  });
});
