CREATE TABLE "legal_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"country" text DEFAULT 'IN' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"state" text,
	"address" text,
	"registrations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"statutory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entities_tenant_code_uq" ON "legal_entities" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entities_one_default_uq" ON "legal_entities" USING btree ("tenant_id") WHERE "legal_entities"."is_default";--> statement-breakpoint
CREATE INDEX "legal_entities_tenant_idx" ON "legal_entities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employees_tenant_entity_idx" ON "employees" USING btree ("tenant_id","entity_id");--> statement-breakpoint
-- Every existing company gets a default legal entity made from its current details.
INSERT INTO "legal_entities" ("id", "tenant_id", "code", "name", "legal_name", "country", "currency", "time_zone", "state", "address", "registrations", "statutory", "is_default")
SELECT gen_random_uuid()::text, t."id", 'E01', t."name", t."legal_name", 'IN', 'INR', 'Asia/Kolkata', t."state", t."registered_address",
  jsonb_strip_nulls(jsonb_build_object('gstin', t."gstin", 'pan', t."pan", 'tan', t."tan", 'cin', t."llpin_cin")),
  t."statutory", true
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "legal_entities" e WHERE e."tenant_id" = t."id" AND e."is_default");--> statement-breakpoint
UPDATE "employees" emp SET "entity_id" = e."id"
FROM "legal_entities" e
WHERE e."tenant_id" = emp."tenant_id" AND e."is_default" AND emp."entity_id" IS NULL;
