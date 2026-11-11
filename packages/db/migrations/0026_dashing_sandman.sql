CREATE TABLE "shift_roster" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"date" date NOT NULL,
	"shift_id" text,
	"is_off" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_roster_emp_date_uq" ON "shift_roster" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "shift_roster_tenant_date_idx" ON "shift_roster" USING btree ("tenant_id","date");