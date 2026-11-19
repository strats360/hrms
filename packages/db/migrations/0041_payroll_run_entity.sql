DROP INDEX "payroll_runs_tenant_month_uq";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "entity_id" text;--> statement-breakpoint
UPDATE "payroll_runs" r SET "entity_id" = e."id" FROM "legal_entities" e WHERE e."tenant_id" = r."tenant_id" AND e."is_default";--> statement-breakpoint
ALTER TABLE "payroll_runs" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_tenant_entity_month_uq" ON "payroll_runs" USING btree ("tenant_id","entity_id","month");
