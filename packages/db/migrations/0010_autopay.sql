CREATE TABLE "billing_mandates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"gateway" text DEFAULT 'cashfree' NOT NULL,
	"subscription_id" text NOT NULL,
	"gateway_subscription_id" text,
	"session_id" text,
	"method" text DEFAULT 'upi' NOT NULL,
	"max_amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'initialized' NOT NULL,
	"gateway_status" text,
	"payer" text,
	"authorized_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failure_reason" text,
	"raw" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "mandate_id" text;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_mandates" ADD CONSTRAINT "billing_mandates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_mandates_sub_uq" ON "billing_mandates" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "billing_mandates_tenant_idx" ON "billing_mandates" USING btree ("tenant_id","status");