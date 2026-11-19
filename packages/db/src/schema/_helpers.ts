import { numeric, text, timestamp } from "drizzle-orm/pg-core";

export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * A money amount. Three decimals so Kuwaiti dinar and Omani rial fit; other currencies round
 * to their own minor units in the app. The currency comes from the legal entity.
 */
export const money = (name: string) => numeric(name, { precision: 16, scale: 3, mode: "number" });
