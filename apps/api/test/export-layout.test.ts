import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { unzipSync, strFromU8 } from "fflate";
import { todayIST } from "@hrms/shared";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client, krupa: Client, priya: Client;
let batchId = "";
const idOf = async (code: string) => (await kunal.get(`/admin/employees?q=${code}`)).body.rows[0].id as string;

beforeAll(async () => {
  [kunal, krupa, priya] = await Promise.all(["kunal.shah", "krupa.joshi", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  const hdfc = (await kunal.get("/admin/payments/accounts")).body.find((a: any) => a.isDefault);
  const lines = [
    { employeeId: await idOf("STL-0042"), amount: 4321, description: "Layout test" },
    { employeeId: await idOf("STL-0057"), amount: 1234, description: "Layout test" },
  ];
  const b = await kunal.post("/admin/payments/batches", { type: "other", bankAccountId: hdfc.id, paymentDate: todayIST(), label: "Export layout test", lines });
  expect(b.status).toBe(201);
  batchId = b.body.id;
  expect((await kunal.post(`/admin/payments/batches/${batchId}/approve`)).status).toBe(200);
});
afterAll(async () => {
  if (batchId) {
    await sql`delete from payments where batch_id = ${batchId}`;
    await sql`delete from payment_batches where id = ${batchId}`;
  }
  await sql`update tenants set settings = settings - 'paymentExportLayout' where code = 'TN-0142'`;
  await sql.end();
});

const layout = { columns: ["employee_code", "beneficiary_name", "account_number", "ifsc", "amount", "payment_date"], fileType: "csv", dateFormat: "YYYY-MM-DD", header: true, bankSafe: true };

describe("Bank file export layout", () => {
  it("starts from a default layout and validates changes", async () => {
    expect((await krupa.get("/admin/payments/export-layout")).body.columns).toContain("account_number");
    expect((await krupa.req("PUT", "/admin/payments/export-layout", { ...layout, columns: ["employee_code", "amount"] })).status).toBe(422);
    expect((await priya.req("PUT", "/admin/payments/export-layout", layout)).status).toBe(403);
  });

  it("previews the first rows with account numbers masked, changing nothing", async () => {
    const r = await krupa.post(`/admin/payments/batches/${batchId}/file/preview`, { format: "custom", layout });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ext: "csv", total: 2, missing: 0, amount: 5555 });
    expect(r.body.preview[0]).toBe("Employee ID,Beneficiary name,Account number,IFSC,Amount,Payment date");
    const row = r.body.preview.find((l: string) => l.startsWith("STL-0042"));
    expect(row).toMatch(/^STL-0042,[A-Z ]+,X+\d{4},[A-Z0-9]{11},4321\.00,\d{4}-\d{2}-\d{2}$/);
    // built-in formats preview too
    const hdfc = await krupa.post(`/admin/payments/batches/${batchId}/file/preview`, { format: "hdfc_enet" });
    expect(hdfc.body.preview).toHaveLength(2);
    const [b] = await sql`select export_count from payment_batches where id = ${batchId}`;
    expect(b!.export_count).toBe(0);
  });

  it("downloads in the saved layout", async () => {
    expect((await krupa.req("PUT", "/admin/payments/export-layout", layout)).status).toBe(200);
    const f = await krupa.get(`/admin/payments/batches/${batchId}/file?format=custom`);
    expect(f.status).toBe(200);
    expect(f.headers.get("content-disposition")).toMatch(/\.csv"/);
    const rows = String(f.body).replace(/^﻿/, "").trim().split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatch(/^STL-0042,[A-Z ]+,\d{6,},/); // the real account number in the file
    const [audit] = await sql`select summary from audit_logs where action = 'payments.file_export' order by created_at desc limit 1`;
    expect(audit!.summary).toMatch(/^Exported Custom layout file/);
  });

  it("writes Excel, with or without a header row", async () => {
    await krupa.req("PUT", "/admin/payments/export-layout", { ...layout, fileType: "xlsx", header: false });
    const f = await krupa.file(`/admin/payments/batches/${batchId}/file?format=custom`);
    expect(f.headers.get("content-type")).toMatch(/spreadsheetml/);
    const zip = unzipSync(new Uint8Array(await f.raw.arrayBuffer()));
    const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]!);
    expect(sheet).not.toMatch(/Employee ID/);
    expect(sheet).toMatch(/<row r="1">.*STL-00/);
    expect(sheet).toMatch(/<v>4321<\/v>/);
  });
});
