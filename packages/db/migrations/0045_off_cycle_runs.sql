DROP INDEX "payroll_runs_tenant_entity_period_uq";--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "label" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_tenant_entity_period_uq" ON "payroll_runs" USING btree ("tenant_id","entity_id","period_start") WHERE "payroll_runs"."kind" = 'regular';