import { Hono, type Context } from "hono";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { adminInvites, employees, memberships, roles, tenants, user } from "@hrms/db";
import { inviteAdminSchema, randomToken, roleSchema, sanitizeMatrix, sha256Hex, updateMemberSchema } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";

export const accessRoutes = new Hono<AppEnv>();

// ---------- roles ----------
accessRoutes.get("/roles", requirePerm("users", "view"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const rows = await db
    .select({
      role: roles,
      members: sql<number>`(select count(*)::int from memberships m where m.role_id = "roles"."id" and m.status = 'active')`,
    })
    .from(roles)
    .where(eq(roles.tenantId, tid))
    .orderBy(roles.createdAt);
  return c.json(rows.map((r) => ({ ...r.role, members: r.members })));
});

accessRoutes.post("/roles", requirePerm("users", "configure"), v("json", roleSchema), async (c) => {
  const body = c.req.valid("json");
  const [row] = await c
    .get("db")
    .insert(roles)
    .values({ tenantId: c.get("tenant").tenantId, name: body.name, description: body.description ?? null, permissions: sanitizeMatrix(body.permissions) })
    .returning();
  await audit(c, { action: "role.create", entity: "role", entityId: row!.id, summary: `Created role ${body.name}` });
  return c.json(row, 201);
});

accessRoutes.patch("/roles/:id", requirePerm("users", "configure"), vPatch(roleSchema.partial()), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [cur] = await db.select().from(roles).where(and(eq(roles.id, c.req.param("id")), eq(roles.tenantId, tid)));
  if (!cur) throw notFound("Role");
  if (cur.key === "super_admin") throw badRequest("Super admin always has full access and can't be changed");
  const body = c.req.valid("json");
  const patch: Partial<typeof roles.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.permissions) patch.permissions = sanitizeMatrix(body.permissions);
  const [row] = await db.update(roles).set(patch).where(eq(roles.id, cur.id)).returning();
  await audit(c, { action: "role.update", entity: "role", entityId: cur.id, summary: `Updated permissions for ${cur.name}`, data: patch });
  return c.json(row);
});

accessRoutes.delete("/roles/:id", requirePerm("users", "configure"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [cur] = await db.select().from(roles).where(and(eq(roles.id, c.req.param("id")), eq(roles.tenantId, tid)));
  if (!cur) throw notFound("Role");
  if (cur.isSystem) throw badRequest("Built-in roles can't be deleted");
  const [inUse] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.roleId, cur.id));
  if ((inUse?.n ?? 0) > 0) throw conflict("Move the users in this role to another role first");
  await db.delete(roles).where(eq(roles.id, cur.id));
  await audit(c, { action: "role.delete", entity: "role", entityId: cur.id, summary: `Deleted role ${cur.name}` });
  return c.json({ ok: true });
});

// ---------- admin users ----------
accessRoutes.get("/members", requirePerm("users", "view"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const rows = await db
    .select({
      id: memberships.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      roleId: roles.id,
      roleName: roles.name,
      scope: memberships.scope,
      status: memberships.status,
      lastActiveAt: memberships.lastActiveAt,
      employeeCode: employees.employeeCode,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .leftJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(employees, eq(employees.id, memberships.employeeId))
    .where(and(eq(memberships.tenantId, tid), isNotNull(memberships.roleId)))
    .orderBy(user.name);
  const invites = await db
    .select({ id: adminInvites.id, name: adminInvites.name, email: adminInvites.email, roleName: roles.name, scope: adminInvites.scope, expiresAt: adminInvites.expiresAt, createdAt: adminInvites.createdAt })
    .from(adminInvites)
    .leftJoin(roles, eq(roles.id, adminInvites.roleId))
    .where(and(eq(adminInvites.tenantId, tid), isNull(adminInvites.acceptedAt)))
    .orderBy(desc(adminInvites.createdAt));
  return c.json({ members: rows, invites });
});

async function sendAdminInvite(c: Context<AppEnv>, inv: { email: string; name: string; token: string; roleName: string }) {
  const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, c.get("tenant").tenantId));
  const url = `${c.env.APP_URL}/invite/admin/${inv.token}`;
  const { html, text } = layout({
    company: t?.name ?? "Strats360 People",
    heading: `You're invited to ${t?.name ?? "the admin console"}`,
    paragraphs: [`Hi ${inv.name},`, `${c.get("session")!.name} invited you to the admin console as ${inv.roleName}.`, "The link works for 7 days."],
    cta: { label: "Accept invite", url },
  });
  await c.get("mailer").send({ to: inv.email, subject: `Invitation to ${t?.name ?? "Strats360 People"}`, html, text });
}

accessRoutes.post("/members/invite", requirePerm("users", "edit"), v("json", inviteAdminSchema), async (c) => {
  const body = c.req.valid("json");
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [role] = await db.select().from(roles).where(and(eq(roles.id, body.roleId), eq(roles.tenantId, tid)));
  if (!role) throw badRequest("Pick a valid role");
  // already a member? just update the role
  const [existingUser] = await db.select().from(user).where(eq(user.email, body.email));
  if (existingUser) {
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, tid), eq(memberships.userId, existingUser.id)));
    if (m) {
      if (m.roleId) throw conflict("This person already has admin access");
      await db.update(memberships).set({ roleId: role.id, scope: body.scope ?? null, status: "active" }).where(eq(memberships.id, m.id));
      await audit(c, { action: "member.grant", entity: "membership", entityId: m.id, summary: `Gave ${body.email} the ${role.name} role` });
      return c.json({ granted: true });
    }
  }
  const token = randomToken();
  const [inv] = await db
    .insert(adminInvites)
    .values({
      tenantId: tid,
      email: body.email,
      name: body.name,
      roleId: role.id,
      scope: body.scope ?? null,
      tokenHash: await sha256Hex(token),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      invitedBy: c.get("session")!.userId,
    })
    .returning();
  await sendAdminInvite(c, { email: body.email, name: body.name, token, roleName: role.name });
  await audit(c, { action: "member.invite", entity: "admin_invite", entityId: inv!.id, summary: `Invited ${body.email} as ${role.name}` });
  return c.json({ invited: true, id: inv!.id }, 201);
});

accessRoutes.delete("/invites/:id", requirePerm("users", "edit"), async (c) => {
  const [row] = await c
    .get("db")
    .delete(adminInvites)
    .where(and(eq(adminInvites.id, c.req.param("id")), eq(adminInvites.tenantId, c.get("tenant").tenantId)))
    .returning();
  if (!row) throw notFound("Invite");
  await audit(c, { action: "member.invite_revoke", entity: "admin_invite", entityId: row.id, summary: `Revoked invite for ${row.email}` });
  return c.json({ ok: true });
});

accessRoutes.patch("/members/:id", requirePerm("users", "edit"), v("json", updateMemberSchema), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const body = c.req.valid("json");
  const [m] = await db.select().from(memberships).where(and(eq(memberships.id, c.req.param("id")), eq(memberships.tenantId, tid)));
  if (!m) throw notFound("User");
  if (m.userId === c.get("session")!.userId && (body.status === "disabled" || body.roleId !== undefined)) {
    throw badRequest("You can't change your own access. Ask another super admin.");
  }
  if (body.roleId) {
    const [r] = await db.select().from(roles).where(and(eq(roles.id, body.roleId), eq(roles.tenantId, tid)));
    if (!r) throw badRequest("Pick a valid role");
  }
  // keep at least one active super admin
  const [cur] = m.roleId ? await db.select().from(roles).where(eq(roles.id, m.roleId)) : [];
  const losingSuper = cur?.key === "super_admin" && (body.status === "disabled" || (body.roleId !== undefined && body.roleId !== m.roleId));
  if (losingSuper) {
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tid), eq(memberships.roleId, cur!.id), eq(memberships.status, "active")));
    if ((n?.n ?? 0) <= 1) throw badRequest("There must be at least one active super admin");
  }
  const patch: Partial<typeof memberships.$inferInsert> = {};
  if (body.roleId !== undefined) patch.roleId = body.roleId;
  if (body.status) patch.status = body.status;
  if (body.scope !== undefined) patch.scope = body.scope;
  // "Remove admin access" for an employee keeps their self-service login
  if (body.roleId === null && !m.employeeId) patch.status = "disabled";
  const [row] = await db.update(memberships).set(patch).where(eq(memberships.id, m.id)).returning();
  await audit(c, { action: "member.update", entity: "membership", entityId: m.id, summary: "Changed admin access", data: patch });
  return c.json(row);
});
