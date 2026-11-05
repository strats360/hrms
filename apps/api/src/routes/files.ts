import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { employeeDocuments } from "@hrms/db";
import { can } from "@hrms/shared";
import type { AppEnv } from "../env";
import { forbidden, notFound } from "../lib/errors";
import { getFile } from "../lib/storage";

export const fileRoutes = new Hono<AppEnv>();

/** Download a document: admins with employees.view, or the employee it belongs to. */
fileRoutes.get("/documents/:id", async (c) => {
  const t = c.get("tenant");
  const [doc] = await c
    .get("db")
    .select()
    .from(employeeDocuments)
    .where(and(eq(employeeDocuments.id, c.req.param("id")), eq(employeeDocuments.tenantId, t.tenantId)));
  if (!doc) throw notFound("Document");
  if (!can(t.permissions, "employees", "view") && doc.employeeId !== t.employeeId) throw forbidden();
  const file = await getFile(c.env, doc.fileKey);
  if (!file) throw notFound("File");
  const name = encodeURIComponent(doc.name);
  return new Response(file.body as BodyInit, {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
