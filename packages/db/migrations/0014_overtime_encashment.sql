CREATE TABLE "leave_encashments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"leave_type_id" text NOT NULL,
	"year" integer NOT NULL,
	"days" numeric(6, 1) NOT NULL,
	"per_day" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reason" text DEFAULT 'request' NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_encashments_tenant_status_idx" ON "leave_encashments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_encashments_year_end_uq" ON "leave_encashments" USING btree ("employee_id","leave_type_id","year") WHERE reason = 'year_end';