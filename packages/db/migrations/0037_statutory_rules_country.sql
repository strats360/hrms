DROP INDEX "statutory_rules_key_idx";--> statement-breakpoint
DROP INDEX "statutory_rules_live_uq";--> statement-breakpoint
ALTER TABLE "statutory_rules" ADD COLUMN "country" text DEFAULT 'IN' NOT NULL;--> statement-breakpoint
CREATE INDEX "statutory_rules_key_idx" ON "statutory_rules" USING btree ("country","key","status","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_rules_live_uq" ON "statutory_rules" USING btree ("country","key","effective_from") WHERE status = 'live';