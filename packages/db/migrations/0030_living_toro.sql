CREATE TABLE "application_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"note" text,
	"by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"job_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"stage" text DEFAULT 'applied' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reject_reason" text,
	"offered_ctc" numeric(14, 2),
	"joining_date" date,
	"offer_designation_id" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"current_company" text,
	"current_title" text,
	"experience_years" numeric(4, 1),
	"current_ctc" numeric(14, 2),
	"expected_ctc" numeric(14, 2),
	"notice_days" integer,
	"location" text,
	"source" text DEFAULT 'other' NOT NULL,
	"referred_by_id" text,
	"notes" text,
	"resume_key" text,
	"resume_name" text,
	"resume_type" text,
	"resume_size" bigint,
	"employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_panel" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"interview_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"rating" integer,
	"recommendation" text,
	"notes" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"round" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"mode" text DEFAULT 'video' NOT NULL,
	"location" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_openings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"department_id" text,
	"designation_id" text,
	"branch_id" text,
	"location" text,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"openings" integer DEFAULT 1 NOT NULL,
	"min_experience" numeric(4, 1),
	"max_experience" numeric(4, 1),
	"min_ctc" numeric(14, 2),
	"max_ctc" numeric(14, 2),
	"description" text DEFAULT '' NOT NULL,
	"hiring_manager_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_job_openings_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_openings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panel" ADD CONSTRAINT "interview_panel_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panel" ADD CONSTRAINT "interview_panel_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panel" ADD CONSTRAINT "interview_panel_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_app_idx" ON "application_events" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_job_candidate_uq" ON "applications" USING btree ("job_id","candidate_id");--> statement-breakpoint
CREATE INDEX "applications_tenant_stage_idx" ON "applications" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX "applications_candidate_idx" ON "applications" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_email_uq" ON "candidates" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "candidates_tenant_idx" ON "candidates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_panel_uq" ON "interview_panel" USING btree ("interview_id","employee_id");--> statement-breakpoint
CREATE INDEX "interview_panel_emp_idx" ON "interview_panel" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "interviews_app_idx" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "interviews_tenant_time_idx" ON "interviews" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_openings_code_uq" ON "job_openings" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "job_openings_tenant_idx" ON "job_openings" USING btree ("tenant_id","status");