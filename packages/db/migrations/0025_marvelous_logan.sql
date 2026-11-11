CREATE TABLE "probation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text NOT NULL,
	"recommendation" text,
	"note" text,
	"date" date,
	"by_user_id" text,
	"by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "probation_reminded_for" date;--> statement-breakpoint
ALTER TABLE "probation_events" ADD CONSTRAINT "probation_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probation_events" ADD CONSTRAINT "probation_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "probation_events_emp_idx" ON "probation_events" USING btree ("employee_id");