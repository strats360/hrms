import { Hono, type Context } from "hono";
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { contractorPayments, contractors } from "@hrms/db";
import { CONTRACTOR_SECTIONS, contractorPaymentSchema, contractorSchema, contractorTds, encryptField, fyOfMonth, sectionName, todayLocal, type ContractorSection } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";

/**
 * Contractors and professionals paid against invoices, with TDS under 194C or 194J (section 393
 * from tax year 2026-27). Payments are worked out here, paid outside payroll, and summed by
 * quarter for the non-salary TDS return.
 */
export const contractorRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;
const fyBounds = (fy: string) => ({ from: `${fy.slice(0, 4)}-04-01`, to: `${Number(fy.slice(0, 4)) + 1}-03-31` });

async function load(c: Context<AppEnv>, id: string) {
  const [row] = await c.get("db").select().from(contractors).where(and(eq(contractors.id, id), eq(contractors.tenantId, tid(c))));
  if (!row) throw notFound("Contractor");
  return row;
}
const view = ({ accountNumberEnc: _a, ...r }: typeof contractors.$inferSelect) => r;

contractorRoutes.get("/", requirePerm("payroll", "view"), async (c) => {
  const db = c.get("db");
  const fy = fyOfMonth(todayLocal().slice(0, 7));
  const { from, to } = fyBounds(fy);
  const [rows, totals] = await Promise.all([
    db.select().from(contractors).where(eq(contractors.tenantId, tid(c))).orderBy(asc(contractors.name)),
    db
      .select({ id: contractorPayments.contractorId, gross: sql<number>`sum(${contractorPayments.gross})::float`, tds: sql<number>`sum(${contractorPayments.tds})::float` })
      .from(contractorPayments)
      .where(and(eq(contractorPayments.tenantId, tid(c)), gte(contractorPayments.invoiceDate, from), lte(contractorPayments.invoiceDate, to)))
      .groupBy(contractorPayments.contractorId),
  ]);
  const t = new Map(totals.map((x) => [x.id, x]));
  return c.json({ fy, sections: CONTRACTOR_SECTIONS, rows: rows.map((r) => ({ ...view(r), paidThisYear: t.get(r.id)?.gross ?? 0, tdsThisYear: t.get(r.id)?.tds ?? 0 })) });
});

async function values(c: Context<AppEnv>, b: z.infer<typeof contractorSchema>) {
  const { accountNumber, ...rest } = b;
  if (accountNumber === undefined) return rest;
  if (accountNumber === null) return { ...rest, accountNumberEnc: null, accountLast4: null };
  return { ...rest, accountNumberEnc: await encryptField(accountNumber, c.env.ENCRYPTION_KEY), accountLast4: accountNumber.slice(-4) };
}

contractorRoutes.post("/", requirePerm("payroll", "edit"), v("json", contractorSchema), async (c) => {
  const b = c.req.valid("json");
  const [row] = await c.get("db").insert(contractors).values({ tenantId: tid(c), ...(await values(c, b)) }).returning();
  await audit(c, { action: "contractor.create", entity: "contractor", entityId: row!.id, summary: `Added contractor ${row!.name}` });
  return c.json(view(row!), 201);
});

contractorRoutes.patch("/:id", requirePerm("payroll", "edit"), v("json", contractorSchema), async (c) => {
  const cur = await load(c, c.req.param("id"));
  const [row] = await c.get("db").update(contractors).set({ ...(await values(c, c.req.valid("json"))), updatedAt: new Date() }).where(eq(contractors.id, cur.id)).returning();
  await audit(c, { action: "contractor.update", entity: "contractor", entityId: cur.id, summary: `Updated contractor ${row!.name}` });
  return c.json(view(row!));
});

/** What TDS a payment would carry, before it's saved. */
async function tdsFor(c: Context<AppEnv>, contractor: typeof contractors.$inferSelect, invoiceDate: string, gross: number, exceptId?: string) {
  const fy = fyOfMonth(invoiceDate.slice(0, 7));
  const { from, to } = fyBounds(fy);
  const [y] = await c
    .get("db")
    .select({ paid: sql<number>`coalesce(sum(${contractorPayments.gross}),0)::float`, untaxed: sql<number>`coalesce(sum(case when ${contractorPayments.tds} = 0 then ${contractorPayments.gross} else 0 end),0)::float` })
    .from(contractorPayments)
    .where(and(eq(contractorPayments.contractorId, contractor.id), gte(contractorPayments.invoiceDate, from), lte(contractorPayments.invoiceDate, to), exceptId ? ne(contractorPayments.id, exceptId) : undefined));
  const section = contractor.section as ContractorSection;
  const r = contractorTds({ section, kind: contractor.kind as "individual" | "company", amount: gross, hasPan: !!contractor.pan, fy, paidThisYear: Number(y?.paid ?? 0), untaxedThisYear: Number(y?.untaxed ?? 0) });
  return { ...r, section, fy, sectionName: sectionName(section, fy) };
}

contractorRoutes.post("/preview", requirePerm("payroll", "view"), v("json", contractorPaymentSchema), async (c) => {
  const b = c.req.valid("json");
  const r = await tdsFor(c, await load(c, b.contractorId), b.invoiceDate, b.gross);
  return c.json({ ...r, net: Math.round((b.gross - r.tds) * 100) / 100 });
});

contractorRoutes.get("/payments", requirePerm("payroll", "view"), v("query", z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() })), async (c) => {
  const fy = c.req.valid("query").fy ?? fyOfMonth(todayLocal().slice(0, 7));
  const { from, to } = fyBounds(fy);
  const rows = await c
    .get("db")
    .select({ p: contractorPayments, name: contractors.name, pan: contractors.pan })
    .from(contractorPayments)
    .innerJoin(contractors, eq(contractors.id, contractorPayments.contractorId))
    .where(and(eq(contractorPayments.tenantId, tid(c)), gte(contractorPayments.invoiceDate, from), lte(contractorPayments.invoiceDate, to)))
    .orderBy(desc(contractorPayments.invoiceDate));
  return c.json({ fy, rows: rows.map((r) => ({ ...r.p, contractorName: r.name, pan: r.pan, sectionName: sectionName(r.p.section as ContractorSection, fy) })) });
});

contractorRoutes.post("/payments", requirePerm("payroll", "edit"), v("json", contractorPaymentSchema), async (c) => {
  const b = c.req.valid("json");
  const ct = await load(c, b.contractorId);
  if (!ct.active) throw badRequest("This contractor is inactive");
  const r = await tdsFor(c, ct, b.invoiceDate, b.gross);
  const [row] = await c
    .get("db")
    .insert(contractorPayments)
    .values({ tenantId: tid(c), contractorId: ct.id, invoiceNo: b.invoiceNo, invoiceDate: b.invoiceDate, description: b.description, gross: b.gross, section: r.section, rate: r.rate, tds: r.tds, net: Math.round((b.gross - r.tds) * 100) / 100, tdsNote: r.note, createdBy: uid(c) })
    .returning();
  await audit(c, { action: "contractor.payment", entity: "contractor_payment", entityId: row!.id, summary: `Recorded a payment of ${b.gross} to ${ct.name}, TDS ${r.tds}` });
  return c.json(row, 201);
});

contractorRoutes.post("/payments/:id/paid", requirePerm("payroll", "approve"), v("json", z.object({ paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().max(60).optional().nullable() })), async (c) => {
  const b = c.req.valid("json");
  const [row] = await c
    .get("db")
    .update(contractorPayments)
    .set({ status: "paid", paidOn: b.paidOn, reference: b.reference ?? null, updatedAt: new Date() })
    .where(and(eq(contractorPayments.id, c.req.param("id")), eq(contractorPayments.tenantId, tid(c))))
    .returning();
  if (!row) throw notFound("Payment");
  await audit(c, { action: "contractor.payment_paid", entity: "contractor_payment", entityId: row.id, summary: `Marked a contractor payment as paid on ${b.paidOn}` });
  return c.json(row);
});

contractorRoutes.delete("/payments/:id", requirePerm("payroll", "edit"), async (c) => {
  const [row] = await c.get("db").select().from(contractorPayments).where(and(eq(contractorPayments.id, c.req.param("id")), eq(contractorPayments.tenantId, tid(c))));
  if (!row) throw notFound("Payment");
  if (row.status === "paid") throw badRequest("A paid payment can't be deleted");
  await c.get("db").delete(contractorPayments).where(eq(contractorPayments.id, row.id));
  return c.json({ ok: true });
});

/** TDS by quarter and section, and the deductee lines for the non-salary TDS return (26Q, or its 2025 Act form). */
contractorRoutes.get("/tds.csv", requirePerm("payroll", "export"), v("query", z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/), quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]) })), async (c) => {
  const { fy, quarter } = c.req.valid("query");
  const y = Number(fy.slice(0, 4));
  const q = { Q1: [`${y}-04-01`, `${y}-06-30`], Q2: [`${y}-07-01`, `${y}-09-30`], Q3: [`${y}-10-01`, `${y}-12-31`], Q4: [`${y + 1}-01-01`, `${y + 1}-03-31`] }[quarter];
  const rows = await c
    .get("db")
    .select({ p: contractorPayments, name: contractors.name, pan: contractors.pan })
    .from(contractorPayments)
    .innerJoin(contractors, eq(contractors.id, contractorPayments.contractorId))
    .where(and(eq(contractorPayments.tenantId, tid(c)), gte(contractorPayments.invoiceDate, q[0]!), lte(contractorPayments.invoiceDate, q[1]!)))
    .orderBy(asc(contractorPayments.invoiceDate));
  const csv = toCsv(
    ["Section", "Deductee", "PAN", "Invoice", "Invoice date", "Amount paid or credited", "TDS rate", "TDS", "Paid on", "Note"],
    rows.map((r) => [sectionName(r.p.section as ContractorSection, fy), r.name, r.pan ?? "PANNOTAVBL", r.p.invoiceNo ?? "", r.p.invoiceDate, Number(r.p.gross).toFixed(2), `${Math.round(Number(r.p.rate) * 10000) / 100}%`, Number(r.p.tds).toFixed(2), r.p.paidOn ?? "", r.p.tdsNote ?? ""]),
  );
  await audit(c, { action: "contractor.tds_export", entity: "contractor_payment", summary: `Exported contractor TDS for ${quarter} ${fy}` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contractor-tds-${fy}-${quarter}.csv"` });
});
