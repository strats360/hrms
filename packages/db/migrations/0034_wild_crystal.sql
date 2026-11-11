CREATE TABLE "helpdesk_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"from_team" boolean DEFAULT false NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"attachment_key" text,
	"attachment_name" text,
	"attachment_type" text,
	"attachment_size" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helpdesk_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" text NOT NULL,
	"employee_id" text NOT NULL,
	"category_key" text NOT NULL,
	"category_label" text NOT NULL,
	"team" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"assignee_id" text,
	"response_due_at" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"rating" integer,
	"rating_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_ticket_id_helpdesk_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."helpdesk_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_assignee_id_employees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helpdesk_messages_ticket_idx" ON "helpdesk_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "helpdesk_number_uq" ON "helpdesk_tickets" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "helpdesk_tenant_status_idx" ON "helpdesk_tickets" USING btree ("tenant_id","status","team");--> statement-breakpoint
CREATE INDEX "helpdesk_emp_idx" ON "helpdesk_tickets" USING btree ("tenant_id","employee_id");