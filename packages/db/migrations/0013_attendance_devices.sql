CREATE TABLE "attendance_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"serial_number" text,
	"branch_id" text,
	"key_hash" text NOT NULL,
	"key_hint" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_punch_at" timestamp with time zone,
	"punch_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_punches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"device_id" text,
	"employee_id" text NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"date" date NOT NULL,
	"direction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "biometric_id" text;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_device_id_attendance_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_devices_tenant_idx" ON "attendance_devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_punches_uq" ON "attendance_punches" USING btree ("tenant_id","employee_id","punched_at");--> statement-breakpoint
CREATE INDEX "attendance_punches_day_idx" ON "attendance_punches" USING btree ("tenant_id","employee_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_tenant_biometric_uq" ON "employees" USING btree ("tenant_id","biometric_id");