CREATE TABLE "contractor_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contractor_id" text NOT NULL,
	"invoice_no" text,
	"invoice_date" date NOT NULL,
	"description" text,
	"gross" numeric(16, 3) NOT NULL,
	"section" text NOT NULL,
	"rate" numeric(16, 3) NOT NULL,
	"tds" numeric(16, 3) NOT NULL,
	"net" numeric(16, 3) NOT NULL,
	"tds_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"paid_on" date,
	"reference" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" text,
	"name" text NOT NULL,
	"pan" text,
	"kind" text DEFAULT 'individual' NOT NULL,
	"section" text DEFAULT '194C' NOT NULL,
	"email" text,
	"phone" text,
	"bank_name" text,
	"account_number_enc" text,
	"account_last4" text,
	"ifsc" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contractor_payments" ADD CONSTRAINT "contractor_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_payments" ADD CONSTRAINT "contractor_payments_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractor_payments_tenant_idx" ON "contractor_payments" USING btree ("tenant_id","invoice_date");--> statement-breakpoint
CREATE INDEX "contractor_payments_contractor_idx" ON "contractor_payments" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "contractors_tenant_idx" ON "contractors" USING btree ("tenant_id");