CREATE TABLE "comp_off_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"work_date" date NOT NULL,
	"day_type" text NOT NULL,
	"work_minutes" integer DEFAULT 0 NOT NULL,
	"days" numeric(3, 1) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"expires_on" date,
	"lapsed_days" numeric(3, 1) DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comp_off_emp_date_uq" ON "comp_off_requests" USING btree ("employee_id","work_date") WHERE status in ('pending', 'approved', 'expired');--> statement-breakpoint
CREATE INDEX "comp_off_tenant_status_idx" ON "comp_off_requests" USING btree ("tenant_id","status");