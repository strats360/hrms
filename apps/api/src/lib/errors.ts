import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, "bad_request", details);
export const unauthorized = (msg = "Please sign in") => new ApiError(401, msg, "unauthorized");
export const forbidden = (msg = "You don't have permission to do that") => new ApiError(403, msg, "forbidden");
export const notFound = (what = "Record") => new ApiError(404, `${what} not found`, "not_found");
export const conflict = (msg: string) => new ApiError(409, msg, "conflict");

/** Postgres unique-violation -> 409 with a readable message. */
function pgError(err: unknown): ApiError | null {
  const e = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const code = e?.code ?? e?.cause?.code;
  const constraint = e?.constraint_name ?? e?.cause?.constraint_name ?? "";
  if (code === "23505") {
    if (constraint.includes("email")) return conflict("That email is already in use");
    if (constraint.includes("code")) return conflict("That code is already in use");
    if (constraint.includes("name")) return conflict("That name already exists");
    return conflict("A record with these details already exists");
  }
  if (code === "23503") return badRequest("A linked record does not exist or is still in use");
  return null;
}

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ error: { message: err.message, code: err.code, details: err.details } }, err.status);
  }
  if (err instanceof ZodError) {
    return c.json(
      { error: { message: err.issues[0]?.message ?? "Invalid input", code: "validation", details: err.issues } },
      422,
    );
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { message: err.message, code: "http" } }, err.status);
  }
  const pg = pgError(err);
  if (pg) return c.json({ error: { message: pg.message, code: pg.code } }, pg.status);
  console.error(err);
  return c.json({ error: { message: "Something went wrong. Please try again.", code: "internal" } }, 500);
}
