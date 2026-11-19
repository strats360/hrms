ALTER TABLE "invoices" ADD COLUMN "tax_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;