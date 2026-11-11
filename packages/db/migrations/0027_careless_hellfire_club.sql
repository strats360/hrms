CREATE TABLE "privacy_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text DEFAULT 'erasure' NOT NULL,
	"source" text DEFAULT 'employee' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"due_date" date,
	"decision_note" text,
	"decided_by" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_tenant_idx" ON "privacy_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "privacy_requests_emp_idx" ON "privacy_requests" USING btree ("employee_id");