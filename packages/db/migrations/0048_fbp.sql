CREATE TABLE "fbp_declarations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"fy" text NOT NULL,
	"allocations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_items" ADD COLUMN "fbp_credit" jsonb;--> statement-breakpoint
ALTER TABLE "reimbursement_categories" ADD COLUMN "fbp_head" text;--> statement-breakpoint
ALTER TABLE "fbp_declarations" ADD CONSTRAINT "fbp_declarations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fbp_declarations" ADD CONSTRAINT "fbp_declarations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fbp_decl_emp_fy_uq" ON "fbp_declarations" USING btree ("tenant_id","employee_id","fy");--> statement-breakpoint
CREATE INDEX "fbp_decl_tenant_fy_idx" ON "fbp_declarations" USING btree ("tenant_id","fy");