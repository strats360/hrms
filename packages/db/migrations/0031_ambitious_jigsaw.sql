CREATE TABLE "asset_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"assigned_on" date NOT NULL,
	"expected_return" date,
	"condition_out" text NOT NULL,
	"note_out" text,
	"assigned_by" text,
	"acknowledged_at" timestamp with time zone,
	"returned_on" date,
	"condition_in" text,
	"note_in" text,
	"returned_by" text,
	"issue" text,
	"issue_note" text,
	"issue_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tag" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"serial_number" text,
	"purchase_date" date,
	"purchase_cost" numeric(14, 2),
	"vendor" text,
	"invoice_number" text,
	"warranty_until" date,
	"branch_id" text,
	"status" text DEFAULT 'available' NOT NULL,
	"condition" text DEFAULT 'good' NOT NULL,
	"notes" text,
	"holder_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_holder_id_employees_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_assignments_asset_idx" ON "asset_assignments" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_assignments_emp_idx" ON "asset_assignments" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_tag_uq" ON "assets" USING btree ("tenant_id","tag");--> statement-breakpoint
CREATE INDEX "assets_tenant_status_idx" ON "assets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "assets_holder_idx" ON "assets" USING btree ("tenant_id","holder_id");