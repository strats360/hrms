CREATE TABLE "claim_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reimbursement_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"limit_amount" numeric(14, 2),
	"limit_period" text DEFAULT 'claim' NOT NULL,
	"rate_per_km" numeric(14, 2),
	"gst_capture" boolean DEFAULT false NOT NULL,
	"approval" text DEFAULT 'manager' NOT NULL,
	"receipt_required_above" numeric(14, 2) DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reimbursement_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"employee_id" text NOT NULL,
	"category_id" text NOT NULL,
	"expense_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"km" numeric(8, 1),
	"vendor" text,
	"gstin" text,
	"gst_amount" numeric(14, 2),
	"project" text,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending_finance' NOT NULL,
	"over_limit" boolean DEFAULT false NOT NULL,
	"manager_approved_by" text,
	"manager_approved_at" timestamp with time zone,
	"finance_approved_by" text,
	"finance_approved_at" timestamp with time zone,
	"rejected_by" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"payroll_run_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_items" ADD COLUMN "reimbursement" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_receipts" ADD CONSTRAINT "claim_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_receipts" ADD CONSTRAINT "claim_receipts_claim_id_reimbursement_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."reimbursement_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_categories" ADD CONSTRAINT "reimbursement_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_category_id_reimbursement_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."reimbursement_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_receipts_claim_idx" ON "claim_receipts" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reimb_cat_tenant_name_uq" ON "reimbursement_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "reimb_claim_code_uq" ON "reimbursement_claims" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "reimb_claim_tenant_status_idx" ON "reimbursement_claims" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "reimb_claim_emp_idx" ON "reimbursement_claims" USING btree ("tenant_id","employee_id");