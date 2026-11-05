CREATE TABLE "payroll_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"esi_wage" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"days_in_month" numeric(5, 1) NOT NULL,
	"paid_days" numeric(5, 1) NOT NULL,
	"lop_days" numeric(5, 1) DEFAULT 0 NOT NULL,
	"lop_override" numeric(5, 1),
	"earnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deductions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"employer" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gross" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_deductions" numeric(14, 2) DEFAULT 0 NOT NULL,
	"net" numeric(14, 2) DEFAULT 0 NOT NULL,
	"employer_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tds" numeric(14, 2) DEFAULT 0 NOT NULL,
	"taxable_gross" numeric(14, 2) DEFAULT 0 NOT NULL,
	"employee_pf" numeric(14, 2) DEFAULT 0 NOT NULL,
	"professional_tax" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax" jsonb,
	"on_hold" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"warnings" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"month" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"totals" jsonb,
	"prepared_by" text,
	"calculated_by" text,
	"calculated_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"paid_by" text,
	"payment_reference" text,
	"bank_file_exported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"annual_ctc" numeric(14, 2) NOT NULL,
	"components" jsonb,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_adj_run_idx" ON "payroll_adjustments" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_items_run_emp_uq" ON "payroll_items" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_items_tenant_emp_idx" ON "payroll_items" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_tenant_month_uq" ON "payroll_runs" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_structures_emp_date_uq" ON "salary_structures" USING btree ("tenant_id","employee_id","effective_from");