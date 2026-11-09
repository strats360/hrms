ALTER TABLE "branches" ADD COLUMN "geo_lat" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "geo_lng" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "geo_radius_m" integer;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "allowed_ips" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "distance_m" integer;