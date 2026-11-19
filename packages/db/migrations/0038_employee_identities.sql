CREATE TABLE "employee_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"number" text NOT NULL,
	"issuing_country" text,
	"issued_on" date,
	"expires_on" date,
	"note" text,
	"reminded_for" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_identities" ADD CONSTRAINT "employee_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_identities" ADD CONSTRAINT "employee_identities_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_identities_emp_idx" ON "employee_identities" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_identities_expiry_idx" ON "employee_identities" USING btree ("tenant_id","expires_on");