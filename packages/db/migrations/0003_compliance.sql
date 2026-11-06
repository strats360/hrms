CREATE TABLE "statutory_challans" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"statute" text NOT NULL,
	"period" text NOT NULL,
	"jurisdiction" text DEFAULT '' NOT NULL,
	"amount_due" numeric(14, 2) NOT NULL,
	"amount_paid" numeric(14, 2) NOT NULL,
	"reference" text,
	"paid_on" date NOT NULL,
	"receipt_key" text,
	"receipt_name" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statutory_challans" ADD CONSTRAINT "statutory_challans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "challans_uq" ON "statutory_challans" USING btree ("tenant_id","statute","period","jurisdiction");--> statement-breakpoint
CREATE INDEX "challans_tenant_period_idx" ON "statutory_challans" USING btree ("tenant_id","period");