import { Hono, type Context } from "hono";
import { and, eq, isNotNull } from "drizzle-orm";
import { employees, memberships, tenants } from "@hrms/db";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { deleteFile, getFile, putFile } from "../lib/storage";

/** Photos arrive already cropped and resized in the browser, so they're small. */
export const MAX_PHOTO_BYTES = 1024 * 1024;

/** Recognise the image from its first bytes; the browser's content type can't be trusted. */
export function imageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** The version in a photo URL changes with each upload, so browsers can cache it for long. */
const version = (key: string) => key.slice(key.lastIndexOf("/photo-") + 7, key.lastIndexOf("/photo-") + 15);

/** Can employees change their own photo? On unless HR turned it off. */
export const essPhotoAllowed = (settings: unknown) => (settings as { essPhotoEdit?: boolean } | null)?.essPhotoEdit !== false;

async function savePhoto(c: Context<AppEnv>, tenantId: string, employeeId: string) {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach a photo");
  if (file.size > MAX_PHOTO_BYTES) throw badRequest("Photos must be 1 MB or smaller");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) throw badRequest("Upload a JPG, PNG or WebP image");
  const db = c.get("db");
  const [e] = await db.select({ id: employees.id, name: employees.fullName, photoKey: employees.photoKey }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  if (!e) throw notFound("Employee");
  const key = `tenants/${tenantId}/employees/${employeeId}/photo-${crypto.randomUUID()}.${type.split("/")[1]}`;
  await putFile(c.env, key, bytes.buffer as ArrayBuffer, type);
  await db.update(employees).set({ photoKey: key }).where(eq(employees.id, employeeId));
  if (e.photoKey) await deleteFile(c.env, e.photoKey).catch(() => {});
  await audit(c, { action: "employee.photo", entity: "employee", entityId: employeeId, summary: `Updated profile photo for ${e.name}` });
  return { photoVersion: version(key) };
}

async function removePhoto(c: Context<AppEnv>, tenantId: string, employeeId: string) {
  const db = c.get("db");
  const [e] = await db.select({ name: employees.fullName, photoKey: employees.photoKey }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  if (!e) throw notFound("Employee");
  if (e.photoKey) {
    await db.update(employees).set({ photoKey: null }).where(eq(employees.id, employeeId));
    await deleteFile(c.env, e.photoKey).catch(() => {});
    await audit(c, { action: "employee.photo_remove", entity: "employee", entityId: employeeId, summary: `Removed profile photo for ${e.name}` });
  }
  return { photoVersion: null };
}

/** Which employees have a photo, for avatars across the app: { employeeId: version }. */
export const photoIndexRoutes = new Hono<AppEnv>();
photoIndexRoutes.get("/", async (c) => {
  const rows = await c
    .get("db")
    .select({ id: employees.id, key: employees.photoKey })
    .from(employees)
    .where(and(eq(employees.tenantId, c.get("tenant").tenantId), isNotNull(employees.photoKey)));
  return c.json(Object.fromEntries(rows.map((r) => [r.id, version(r.key!)])));
});

export const adminPhotoRoutes = new Hono<AppEnv>();
adminPhotoRoutes.post("/:id/photo", requirePerm("employees", "edit"), async (c) => c.json(await savePhoto(c, c.get("tenant").tenantId, c.req.param("id")), 201));
adminPhotoRoutes.delete("/:id/photo", requirePerm("employees", "edit"), async (c) => c.json(await removePhoto(c, c.get("tenant").tenantId, c.req.param("id"))));

export const essPhotoRoutes = new Hono<AppEnv>();
essPhotoRoutes.use("*", requireEmployee);
essPhotoRoutes.use("*", async (c, next) => {
  const [t] = await c.get("db").select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, c.get("tenant").tenantId));
  if (!essPhotoAllowed(t?.settings)) throw forbidden("Your company's HR team manages profile photos. Ask them to change yours.");
  await next();
});
essPhotoRoutes.post("/", async (c) => c.json(await savePhoto(c, c.get("tenant").tenantId, c.get("tenant").employeeId!), 201));
essPhotoRoutes.delete("/", async (c) => c.json(await removePhoto(c, c.get("tenant").tenantId, c.get("tenant").employeeId!)));

/**
 * The image itself. Image tags can't send the company header, so this checks that the
 * signed-in person belongs to the employee's company.
 */
export const photoServeRoutes = new Hono<AppEnv>();
photoServeRoutes.get("/:employeeId", async (c) => {
  const db = c.get("db");
  const [e] = await db.select({ tenantId: employees.tenantId, key: employees.photoKey }).from(employees).where(eq(employees.id, c.req.param("employeeId")));
  if (!e?.key) throw notFound("Photo");
  const [m] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.tenantId, e.tenantId), eq(memberships.userId, c.get("session")!.userId), eq(memberships.status, "active")));
  if (!m) throw notFound("Photo");
  const file = await getFile(c.env, e.key);
  if (!file) throw notFound("Photo");
  // versioned URLs: a new upload gets a new address, so the old one can be cached
  const cache = c.req.query("v") === version(e.key) ? "private, max-age=2592000, immutable" : "private, no-cache";
  return c.body(file.body as never, 200, { "Content-Type": file.type, "Cache-Control": cache, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" });
});
