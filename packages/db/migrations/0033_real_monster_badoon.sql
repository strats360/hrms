CREATE TABLE "announcement_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"audience" jsonb DEFAULT '{"departmentIds":[],"branchIds":[]}'::jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"require_ack" boolean DEFAULT false NOT NULL,
	"email_everyone" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"publish_at" timestamp with time zone,
	"expires_at" date,
	"emailed_at" timestamp with time zone,
	"attachment_key" text,
	"attachment_name" text,
	"attachment_type" text,
	"attachment_size" bigint,
	"author_id" text,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_reads_uq" ON "announcement_reads" USING btree ("announcement_id","employee_id");--> statement-breakpoint
CREATE INDEX "announcement_reads_emp_idx" ON "announcement_reads" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "announcements_tenant_idx" ON "announcements" USING btree ("tenant_id","status","publish_at");