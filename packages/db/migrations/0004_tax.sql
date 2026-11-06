CREATE TABLE "tax_declarations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"fy" text NOT NULL,
	"regime" text DEFAULT 'new' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"declaration_id" text NOT NULL,
	"section" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tds_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"fy" text NOT NULL,
	"quarter" text NOT NULL,
	"filed_on" date NOT NULL,
	"acknowledgement" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_proofs" ADD CONSTRAINT "tax_proofs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_proofs" ADD CONSTRAINT "tax_proofs_declaration_id_tax_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."tax_declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_returns" ADD CONSTRAINT "tds_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_decl_emp_fy_uq" ON "tax_declarations" USING btree ("tenant_id","employee_id","fy");--> statement-breakpoint
CREATE INDEX "tax_decl_tenant_fy_idx" ON "tax_declarations" USING btree ("tenant_id","fy");--> statement-breakpoint
CREATE INDEX "tax_proofs_decl_idx" ON "tax_proofs" USING btree ("declaration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tds_returns_uq" ON "tds_returns" USING btree ("tenant_id","fy","quarter");