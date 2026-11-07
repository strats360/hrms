CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" text NOT NULL,
	"period" text NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"plan_key" text NOT NULL,
	"plan_name" text NOT NULL,
	"seats" integer NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"cgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"igst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"paid_on" date,
	"payment_method" text,
	"payment_reference" text,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"void_reason" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"price_per_employee" numeric(14, 2),
	"min_seats" integer DEFAULT 0 NOT NULL,
	"max_employees" integer,
	"included_admins" integer,
	"description" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "custom_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_period_uq" ON "invoices" USING btree ("tenant_id","period") WHERE status <> 'void';--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_uq" ON "plans" USING btree ("key");