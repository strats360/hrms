CREATE TABLE "feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"rollout" text DEFAULT 'all' NOT NULL,
	"plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tenant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_tenant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"percent" integer DEFAULT 100 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"scope" text DEFAULT 'All India' NOT NULL,
	"value" jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text,
	"notes" text,
	"created_by" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_access" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"staff_user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"tenant_id" text NOT NULL,
	"raised_by" text NOT NULL,
	"subject" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"priority" text DEFAULT 'P3' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"allow_access" boolean DEFAULT false NOT NULL,
	"response_due_at" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"author_kind" text NOT NULL,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_access" ADD CONSTRAINT "support_access_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access" ADD CONSTRAINT "support_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_uq" ON "feature_flags" USING btree ("key");--> statement-breakpoint
CREATE INDEX "statutory_rules_key_idx" ON "statutory_rules" USING btree ("key","status","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_rules_live_uq" ON "statutory_rules" USING btree ("key","effective_from") WHERE status = 'live';--> statement-breakpoint
CREATE INDEX "support_access_staff_idx" ON "support_access" USING btree ("staff_user_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_number_uq" ON "support_tickets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "support_tickets_tenant_idx" ON "support_tickets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");