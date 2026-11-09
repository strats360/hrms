CREATE TABLE "employee_exits" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"employee_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'notice' NOT NULL,
	"previous_status" text,
	"reason" text,
	"resignation_date" date NOT NULL,
	"last_working_day" date NOT NULL,
	"notice_days" integer DEFAULT 30 NOT NULL,
	"notice_waived" boolean DEFAULT false NOT NULL,
	"pay_in_lieu" boolean DEFAULT false NOT NULL,
	"clearance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settlement" jsonb,
	"net_amount" numeric(14, 2),
	"prepared_by" text,
	"prepared_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"payment_id" text,
	"settled_at" timestamp with time zone,
	"settled_on" date,
	"settlement_method" text,
	"settlement_reference" text,
	"cancel_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_exits" ADD CONSTRAINT "employee_exits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_exits" ADD CONSTRAINT "employee_exits_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_exits" ADD CONSTRAINT "employee_exits_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_exits_code_uq" ON "employee_exits" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_exits_open_uq" ON "employee_exits" USING btree ("employee_id") WHERE status not in ('settled', 'cancelled');--> statement-breakpoint
CREATE INDEX "employee_exits_tenant_status_idx" ON "employee_exits" USING btree ("tenant_id","status");