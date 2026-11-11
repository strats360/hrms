-- New permission modules: recruitment, assets, helpdesk. Give existing system roles the same defaults new companies get.
UPDATE "roles" SET "permissions" = "permissions" || '{"recruitment":["view","edit","approve","export","configure"],"assets":["view","edit","approve","export","configure"],"helpdesk":["view","edit","approve","export","configure"]}'::jsonb WHERE "key" IN ('super_admin', 'hr_admin');--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || '{"recruitment":["view"]}'::jsonb WHERE "key" = 'manager';--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || '{"assets":["view"]}'::jsonb WHERE "key" IN ('finance_approver', 'viewer');
