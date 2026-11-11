CREATE TABLE "performance_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"manager_id" text,
	"stage" text DEFAULT 'self' NOT NULL,
	"self" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manager" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"self_score" numeric(3, 1),
	"manager_score" numeric(3, 1),
	"final_rating" numeric(3, 1),
	"calibration_note" text,
	"calibrated_by" text,
	"employee_comment" text,
	"self_submitted_at" timestamp with time zone,
	"manager_submitted_at" timestamp with time zone,
	"shared_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"self_due" date NOT NULL,
	"manager_due" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" jsonb DEFAULT '{"departmentIds":[],"branchIds":[],"joinedBy":null}'::jsonb NOT NULL,
	"created_by" text,
	"launched_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"review_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"weight" integer NOT NULL,
	"self_rating" integer,
	"self_comment" text,
	"manager_rating" integer,
	"manager_comment" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_goals" ADD CONSTRAINT "review_goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_goals" ADD CONSTRAINT "review_goals_review_id_performance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "performance_reviews_cycle_emp_uq" ON "performance_reviews" USING btree ("cycle_id","employee_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_emp_idx" ON "performance_reviews" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_mgr_idx" ON "performance_reviews" USING btree ("tenant_id","manager_id");--> statement-breakpoint
CREATE INDEX "review_cycles_tenant_idx" ON "review_cycles" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "review_goals_review_idx" ON "review_goals" USING btree ("review_id");