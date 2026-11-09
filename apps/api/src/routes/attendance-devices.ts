import { Hono, type Context } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { attendanceDevices, branches, tenants } from "@hrms/db";
import { DEFAULT_PUNCH_POLICY, randomToken, sha256Hex, type PunchPolicy } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { parseCsv, toCsv } from "../lib/csv";
import { importAttendance, ingestPunches } from "../services/attendance-import";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

// ---------------------------------------------------------------------------
// Bulk upload
// ---------------------------------------------------------------------------
export const attendanceImportRoutes = new Hono<AppEnv>();

attendanceImportRoutes.get("/import/template.csv", requirePerm("attendance", "edit"), (c) =>
  c.body(
    toCsv(
      ["Employee ID", "Date", "Check in", "Check out", "Status", "Note"],
      [
        ["STL-0042", "03-11-2026", "09:12", "18:40", "", ""],
        ["STL-0042", "04-11-2026", "", "", "L", "Sick leave"],
        ["STL-0057", "03-11-2026", "10:05", "19:10", "", "Biometric export"],
        ["STL-0057", "04-11-2026", "09:30", "", "WFH", ""],
      ],
    ),
    200,
    { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="attendance-upload-template.csv"' },
  ),
);

attendanceImportRoutes.post(
  "/import",
  requirePerm("attendance", "edit"),
  v("json", z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(true), overwrite: z.boolean().default(false) })),
  async (c) => {
    const b = c.req.valid("json");
    let r;
    try {
      r = await importAttendance(c.get("db"), tid(c), parseCsv(b.csv), { dryRun: b.dryRun, overwrite: b.overwrite });
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    if (!b.dryRun && r.written) await audit(c, { action: "attendance.import", entity: "attendance", summary: `Uploaded attendance: ${r.create} new, ${r.update} replaced, ${r.skip} skipped, ${r.errors} with errors` });
    // the full list can be long; errors first, then the rest
    const ordered = [...r.results.filter((x) => x.action === "error"), ...r.results.filter((x) => x.action !== "error")];
    return c.json({ ...r, results: ordered.slice(0, 2000), truncated: r.results.length > 2000 });
  },
);

// ---------------------------------------------------------------------------
// Where punches may come from
// ---------------------------------------------------------------------------
const punchPolicySchema = z.object({ location: z.enum(["off", "flag", "block"]), ip: z.enum(["off", "flag", "block"]), wfhExempt: z.boolean() });

attendanceImportRoutes.get("/punch-policy", requirePerm("attendance", "view"), async (c) => {
  const db = c.get("db");
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tid(c)));
  const rows = await db.select({ name: branches.name, lat: branches.geoLat, radius: branches.geoRadiusM, ips: branches.allowedIps }).from(branches).where(eq(branches.tenantId, tid(c)));
  return c.json({
    policy: { ...DEFAULT_PUNCH_POLICY, ...((t?.s as { punchPolicy?: Partial<PunchPolicy> } | undefined)?.punchPolicy ?? {}) },
    offices: rows.map((b) => ({ name: b.name, location: b.lat !== null && !!b.radius, ips: (b.ips ?? []).length })),
  });
});

attendanceImportRoutes.put("/punch-policy", requirePerm("attendance", "configure"), v("json", punchPolicySchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  if (b.location !== "off" || b.ip !== "off") {
    const rows = await db.select({ lat: branches.geoLat, radius: branches.geoRadiusM, ips: branches.allowedIps }).from(branches).where(eq(branches.tenantId, tid(c)));
    if (b.location !== "off" && !rows.some((r) => r.lat !== null && r.radius)) throw badRequest("Set an office location on at least one branch first (Settings › Branches)");
    if (b.ip !== "off" && !rows.some((r) => (r.ips ?? []).length)) throw badRequest("Add the office IP addresses to at least one branch first (Settings › Branches)");
  }
  await db.update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ punchPolicy: b })}::jsonb` }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "attendance.punch_policy", entity: "tenant", summary: `Punch checks: location ${b.location}, office network ${b.ip}${b.wfhExempt ? ", work from home exempt" : ""}`, data: b });
  return c.json(b);
});

// ---------------------------------------------------------------------------
// Biometric devices (admin)
// ---------------------------------------------------------------------------
const deviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  serialNumber: z.string().trim().max(80).nullable().optional(),
  branchId: z.string().nullable().optional(),
});

/** dev_<device id>.<secret>. Only the hash of the secret is stored. */
async function newKey(deviceId: string) {
  const secret = randomToken(24);
  return { key: `dev_${deviceId}.${secret}`, keyHash: await sha256Hex(secret), keyHint: secret.slice(-4) };
}

const deviceView = (d: typeof attendanceDevices.$inferSelect, branch?: string | null) => ({
  id: d.id,
  name: d.name,
  serialNumber: d.serialNumber,
  branchId: d.branchId,
  branch: branch ?? null,
  keyHint: d.keyHint,
  active: d.active,
  lastSeenAt: d.lastSeenAt,
  lastPunchAt: d.lastPunchAt,
  punchCount: d.punchCount,
  createdAt: d.createdAt,
});

attendanceImportRoutes.get("/devices", requirePerm("attendance", "view"), async (c) => {
  const rows = await c.get("db").select({ d: attendanceDevices, branch: branches.name }).from(attendanceDevices).leftJoin(branches, eq(branches.id, attendanceDevices.branchId)).where(eq(attendanceDevices.tenantId, tid(c))).orderBy(desc(attendanceDevices.createdAt));
  return c.json({ endpoint: `${c.env.APP_URL}/api/public/attendance/punches`, rows: rows.map((r) => deviceView(r.d, r.branch)) });
});

attendanceImportRoutes.post("/devices", requirePerm("attendance", "configure"), v("json", deviceSchema), async (c) => {
  const b = c.req.valid("json");
  const id = crypto.randomUUID();
  const k = await newKey(id);
  const [d] = await c.get("db").insert(attendanceDevices).values({ id, tenantId: tid(c), name: b.name, serialNumber: b.serialNumber ?? null, branchId: b.branchId ?? null, keyHash: k.keyHash, keyHint: k.keyHint, createdBy: c.get("session")!.userId }).returning();
  await audit(c, { action: "attendance.device_add", entity: "attendance_device", entityId: id, summary: `Added attendance device ${b.name}` });
  // the key is shown once
  return c.json({ ...deviceView(d!), key: k.key }, 201);
});

attendanceImportRoutes.post("/devices/:id/rotate", requirePerm("attendance", "configure"), async (c) => {
  const db = c.get("db");
  const [d] = await db.select().from(attendanceDevices).where(and(eq(attendanceDevices.id, c.req.param("id")), eq(attendanceDevices.tenantId, tid(c))));
  if (!d) throw notFound("Device");
  const k = await newKey(d.id);
  const [row] = await db.update(attendanceDevices).set({ keyHash: k.keyHash, keyHint: k.keyHint }).where(eq(attendanceDevices.id, d.id)).returning();
  await audit(c, { action: "attendance.device_key", entity: "attendance_device", entityId: d.id, summary: `Issued a new key for ${d.name}. The old key stopped working.` });
  return c.json({ ...deviceView(row!), key: k.key });
});

attendanceImportRoutes.patch("/devices/:id", requirePerm("attendance", "configure"), vPatch(deviceSchema.partial().extend({ active: z.boolean().optional() })), async (c) => {
  const b = c.req.valid("json");
  const [row] = await c.get("db").update(attendanceDevices).set(b).where(and(eq(attendanceDevices.id, c.req.param("id")), eq(attendanceDevices.tenantId, tid(c)))).returning();
  if (!row) throw notFound("Device");
  await audit(c, { action: "attendance.device_update", entity: "attendance_device", entityId: row.id, summary: `${b.active === false ? "Turned off" : b.active ? "Turned on" : "Updated"} attendance device ${row.name}` });
  return c.json(deviceView(row));
});

// ---------------------------------------------------------------------------
// Public: devices (or the middleware that reads them) push punches here
// ---------------------------------------------------------------------------
export const devicePunchRoutes = new Hono<AppEnv>();

const punchBody = z.object({
  punches: z
    .array(
      z.object({
        userId: z.union([z.string(), z.number()]).transform(String),
        time: z.string().min(10).max(40),
        direction: z.enum(["in", "out"]).nullable().optional(),
      }),
    )
    .min(1)
    .max(2000),
});

devicePunchRoutes.post("/punches", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const m = auth.match(/^Bearer dev_([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/);
  if (!m) throw new ApiError(401, "Send the device key as: Authorization: Bearer dev_…", "unauthorized");
  const db = c.get("db");
  const [d] = await db.select().from(attendanceDevices).where(eq(attendanceDevices.id, m[1]!));
  if (!d || d.keyHash !== (await sha256Hex(m[2]!))) throw new ApiError(401, "Unknown or replaced device key", "unauthorized");
  if (!d.active) throw new ApiError(403, "This device is turned off in the HRMS", "forbidden");
  let body: z.infer<typeof punchBody>;
  try {
    body = punchBody.parse(await c.req.json());
  } catch (e) {
    throw badRequest(e instanceof z.ZodError ? (e.issues[0]?.message ?? "Invalid body") : 'Send JSON: { "punches": [{ "userId": "STL-0042", "time": "2026-11-05 09:02:10" }] }');
  }
  return c.json(await ingestPunches(db, d, body.punches));
});
