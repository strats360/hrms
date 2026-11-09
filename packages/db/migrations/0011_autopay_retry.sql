ALTER TABLE "invoice_payments" ADD COLUMN "retry_of" text;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "retry_at" timestamp with time zone;