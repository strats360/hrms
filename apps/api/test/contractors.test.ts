import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let krupa: Client;
const ids: string[] = [];

beforeAll(async () => {
  krupa = await login("krupa.joshi@strats360.com");
});
afterAll(async () => {
  if (ids.length) await sql`delete from contractors where id in ${sql(ids)}`;
  await sql.end();
});

describe("contractor payments", () => {
  it("takes 194C TDS, catching up earlier payments once the year goes over ₹1,00,000", async () => {
    const c = await krupa.post("/admin/contractors", { name: "Ravi Electricals", pan: "ABCPR1234K", kind: "individual", section: "194C", accountNumber: "123456789012", ifsc: "HDFC0001234" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    ids.push(c.body.id);
    expect(c.body.accountLast4).toBe("9012");
    expect(c.body.accountNumberEnc).toBeUndefined();
    const first = await krupa.post("/admin/contractors/payments", { contractorId: c.body.id, invoiceNo: "INV-1", invoiceDate: "2026-10-05", gross: 25000 });
    expect(first.body).toMatchObject({ tds: 0, net: 25000 });
    const preview = await krupa.post("/admin/contractors/preview", { contractorId: c.body.id, invoiceDate: "2026-11-05", gross: 90000 });
    expect(preview.body).toMatchObject({ tds: 1150, net: 88850, sectionName: "393 (was 194C)" });
    const second = await krupa.post("/admin/contractors/payments", { contractorId: c.body.id, invoiceNo: "INV-2", invoiceDate: "2026-11-05", gross: 90000 });
    expect(second.body.tdsNote).toMatch(/including ₹25,000 paid earlier/);
    expect((await krupa.post(`/admin/contractors/payments/${second.body.id}/paid`, { paidOn: "2026-11-10" })).body.status).toBe("paid");
    expect((await krupa.del(`/admin/contractors/payments/${second.body.id}`)).status).toBe(400);
  });

  it("takes 20% from a professional without a PAN, and exports the quarter", async () => {
    const c = await krupa.post("/admin/contractors", { name: "Asha Design Studio", kind: "individual", section: "194J_professional" });
    ids.push(c.body.id);
    const p = await krupa.post("/admin/contractors/payments", { contractorId: c.body.id, invoiceDate: "2026-11-12", gross: 60000 });
    expect(p.body).toMatchObject({ tds: 12000, net: 48000 });
    const list = (await krupa.get("/admin/contractors")).body.rows.find((r: any) => r.id === c.body.id);
    expect(list).toMatchObject({ paidThisYear: 60000, tdsThisYear: 12000 });
    const f = await krupa.file("/admin/contractors/tds.csv?fy=2026-27&quarter=Q3");
    expect(f.status).toBe(200);
    const text = await f.raw.text();
    expect(text).toMatch(/393 \(was 194J\),Asha Design Studio,PANNOTAVBL,,2026-11-12,60000.00,20%,12000.00/);
    expect(text).toMatch(/Ravi Electricals/);
  });
});
