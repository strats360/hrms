CREATE TABLE "contract_labour_months" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contractor_id" text NOT NULL,
	"month" text NOT NULL,
	"workers" integer DEFAULT 0 NOT NULL,
	"wages_paid_on" date,
	"pf_challan" text,
	"esi_challan" text,
	"note" text,
	"checked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contractor_id" text NOT NULL,
	"name" text NOT NULL,
	"gender" text NOT NULL,
	"date_of_birth" date,
	"aadhaar_last4" text,
	"uan" text,
	"esic_ip_number" text,
	"joined_on" date NOT NULL,
	"left_on" date,
	"daily_wage" numeric(16, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "supplies_labour" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "labour_licence" text;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "licence_valid_until" date;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "work_nature" text;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "contract_from" date;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "contract_to" date;--> statement-breakpoint
ALTER TABLE "contract_labour_months" ADD CONSTRAINT "contract_labour_months_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_labour_months" ADD CONSTRAINT "contract_labour_months_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_workers" ADD CONSTRAINT "contract_workers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_workers" ADD CONSTRAINT "contract_workers_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_labour_months_uq" ON "contract_labour_months" USING btree ("contractor_id","month");--> statement-breakpoint
CREATE INDEX "contract_workers_contractor_idx" ON "contract_workers" USING btree ("contractor_id");