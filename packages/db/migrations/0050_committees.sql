CREATE TABLE "committee_case_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"case_id" text NOT NULL,
	"author_user_id" text,
	"author_name" text,
	"kind" text DEFAULT 'note' NOT NULL,
	"status" text,
	"body_enc" text,
	"visible_to_complainant" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"committee_id" text NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"complainant_id" text NOT NULL,
	"respondent_id" text,
	"respondent_name" text,
	"subject" text NOT NULL,
	"description_enc" text NOT NULL,
	"incident_date" date,
	"filed_on" date NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"report_on" date,
	"closed_on" date,
	"outcome_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committees" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"constituted_on" date NOT NULL,
	"term_ends_on" date,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workshops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "committee_case_notes" ADD CONSTRAINT "committee_case_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_case_notes" ADD CONSTRAINT "committee_case_notes_case_id_committee_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."committee_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_cases" ADD CONSTRAINT "committee_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_cases" ADD CONSTRAINT "committee_cases_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_cases" ADD CONSTRAINT "committee_cases_complainant_id_employees_id_fk" FOREIGN KEY ("complainant_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "committee_case_notes_case_idx" ON "committee_case_notes" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "committee_cases_code_uq" ON "committee_cases" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "committee_cases_committee_idx" ON "committee_cases" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committees_tenant_idx" ON "committees" USING btree ("tenant_id");