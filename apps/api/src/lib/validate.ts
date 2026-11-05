import { createMiddleware } from "hono/factory";
import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler, ValidationTargets } from "hono";
import type { z } from "zod";
import type { ZodType } from "zod";

/** zValidator that returns our standard error shape (422). */
export const v = <T extends ZodType, K extends keyof ValidationTargets>(target: K, schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path?.join(".");
      return c.json(
        {
          error: {
            message: issue ? (field ? `${field}: ${issue.message}` : issue.message) : "Invalid input",
            code: "validation",
            details: result.error.issues,
          },
        },
        422,
      );
    }
  });

/**
 * Validator for PATCH bodies. Zod 4 still applies `.default()` inside `.partial()`,
 * so a partial update would silently reset omitted fields. This keeps only the keys
 * the client actually sent.
 */
export const vPatch = <T extends ZodType>(schema: T): MiddlewareHandler<any, string, { in: { json: z.input<T> }; out: { json: z.output<T> } }> =>
  createMiddleware(async (c, next) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: { message: "Send a JSON body", code: "validation" } }, 422);
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path?.join(".");
      return c.json({ error: { message: issue ? (field ? `${field}: ${issue.message}` : issue.message) : "Invalid input", code: "validation", details: result.error.issues } }, 422);
    }
    const sent = raw && typeof raw === "object" ? new Set(Object.keys(raw as object)) : new Set<string>();
    const data = Object.fromEntries(Object.entries(result.data as object).filter(([k]) => sent.has(k)));
    c.req.addValidatedData("json", data);
    await next();
  });
