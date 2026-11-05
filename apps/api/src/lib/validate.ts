import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
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
