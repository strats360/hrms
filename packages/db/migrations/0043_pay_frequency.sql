DROP INDEX "payroll_runs_tenant_entity_month_uq";--> statement-breakpoint
ALTER TABLE "legal_entities" ADD COLUMN "pay_frequency" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD COLUMN "pay_anchor" date;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "frequency" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_tenant_entity_period_uq" ON "payroll_runs" USING btree ("tenant_id","entity_id","period_start");