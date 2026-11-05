# Strats360 People (HRMS)

A multi-tenant HRMS for Indian companies. It runs on Cloudflare Workers with Neon Postgres.

The product design lives in [`design/`](design/). `HRMS v2.dc.html` is the source of truth for screens and copy, and `chat-transcript.md` records the decisions behind it.

## What's in Phase 1

| Area | What works |
| --- | --- |
| Sign-in | Email and password (Better Auth), password reset by email, rate limiting, sessions in Postgres |
| Company signup | Self-serve trial signup, then a setup wizard (company details, statutory registrations, branches, payroll cycle, invite admins) |
| Multi-tenancy | Every row is scoped by `tenant_id`; a suspended tenant can't sign in |
| Access control | Roles with a module × action matrix (view, create/edit, approve, export, configure), custom roles, admin invites. Managers only see their own team in approval queues |
| Employees | Directory with search, filters, sort and pagination; profile tabs; add and edit; CSV import (dry run first) and export; documents on R2; bank account numbers encrypted at rest |
| Self-onboarding | HR adds a new joiner, and the employee gets an email invite. They set a password and fill in personal, address, bank, tax and document details. HR then verifies and activates them |
| Attendance | Web/mobile punch (with optional GPS), WFH, a live today view, monthly register, correction requests with approval, manual entry, shifts and weekly offs, CSV export |
| Leave | Leave types and accrual (yearly, monthly, prorated for joiners), balances, apply (self or on behalf), approve or reject with reason, cancel, holiday calendar, leave register export |
| Self-service portal | Mobile-first: punch in/out, attendance history, leave, profile and documents |
| Platform console | A separate super admin area with tenant list, plan and status changes (suspend/reactivate), staff list and a cross-tenant audit log |
| Audit log | Changes to records, approvals, exports and views of full bank account numbers |

Phase 2 covers payroll, statutory compliance (EPF, ESI, PT, LWF), TDS, reimbursements, payments, reports, and billing for the SaaS. These modules already appear in the navigation with a "Soon" label.

## Architecture

```
apps/
  api/      Hono app on Cloudflare Workers. Serves /api/* and the built web app (static assets).
  web/      React 19 + Vite + Tailwind v4 + TanStack Query/Table, shadcn-style components themed with Nocturne
packages/
  db/       Drizzle ORM schema, SQL migrations, Postgres client
  shared/   Zod schemas, permission model, attendance and leave rules, INR/IST formatting, field encryption
design/     Claude Design handoff (prototype HTML, design system, transcript)
```

- **Database:** Neon Postgres, reached from the Worker through Cloudflare Hyperdrive (connection pooling and caching) using `postgres.js`.
- **Auth:** Better Auth with the Drizzle adapter. Public `sign-up` is closed. Logins are only created by company signup, employee invites and admin invites.
- **Files:** Cloudflare R2. The API checks permissions on every download.
- **Email:** Resend over `fetch`. If `RESEND_API_KEY` isn't set, emails are printed to the Worker log, which is handy in development.
- **Times:** stored as UTC timestamps. Dates and attendance rules use IST.

## Local development

You need Node 20+, pnpm 10 and Postgres 15+ (local, or a Neon dev branch).

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then fill in the secrets
cp apps/api/.dev.vars packages/db/.env             # db scripts read DATABASE_URL from here

pnpm db:migrate                   # apply migrations
pnpm --filter @hrms/api seed      # demo company with 250 employees (dev only)
pnpm dev                          # API on :8787 (wrangler), web on :5173 (vite proxies /api)
```

Generate the two secrets with `openssl rand -base64 32`.

**Demo logins** (password `Demo@12345`):

| Email | Role |
| --- | --- |
| kunal.shah@strats360.com | Tenant super admin |
| nisha.trivedi@strats360.com | HR admin |
| krupa.joshi@strats360.com | Payroll admin |
| hardik.mehta@strats360.com | Manager (Engineering) |
| priya.vaghela@strats360.com | Employee (self-service only) |
| platform@strats360people.in | Platform super admin |

The seed prints an onboarding invite link for a new joiner, so you can try the self-onboarding flow.

### Tests

```bash
pnpm test        # shared unit tests + API integration tests
pnpm typecheck
```

The API tests rebuild the `hrms_test` database (`TEST_DATABASE_URL`, default `postgres://hrms:hrms@localhost:5432/hrms_test`), run migrations and the seed, then test real HTTP flows. That covers auth, tenant isolation, permissions, onboarding, leave and attendance.

## Deploying to Cloudflare + Neon

1. **Neon:** create a project (region `aws-ap-south-1`, Mumbai, keeps data in India). Copy the connection string, then run the migrations from your machine:
   ```bash
   DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require" pnpm db:migrate
   ```
2. **Hyperdrive:** create it, then paste the id into `apps/api/wrangler.jsonc`:
   ```bash
   cd apps/api
   npx wrangler hyperdrive create hrms-db --connection-string="postgres://...neon.tech/neondb?sslmode=require"
   ```
3. **R2:** `npx wrangler r2 bucket create hrms-files`
4. **Secrets:**
   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET   # openssl rand -base64 32
   npx wrangler secret put ENCRYPTION_KEY       # openssl rand -base64 32, back it up, never rotate without re-encrypting
   npx wrangler secret put RESEND_API_KEY
   ```
5. **Vars:** set `APP_URL` (your domain) and `EMAIL_FROM` (a verified Resend sender) in `wrangler.jsonc`.
6. **Deploy:** run `pnpm release` from the repo root. It builds the web app and deploys one Worker with the static assets. Then add your custom domain in the Cloudflare dashboard.
7. **First platform admin:** create your SaaS operator login:
   ```bash
   DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require" pnpm --filter @hrms/api platform-admin -- --email you@yourcompany.in --name "Your Name"
   ```

The `Deploy` GitHub workflow does steps 1 and 6 on demand. It needs these repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL`.

**Recommended Cloudflare settings:** add a WAF rate-limiting rule on `/api/public/*` and `/api/auth/*`, turn on Bot Fight Mode, and require Always Use HTTPS.

## Security notes

- Every tenant query filters by the `tenant_id` from the server-side membership, never from client input. The `X-Tenant-Id` header only chooses between the user's own memberships.
- Bank account numbers are encrypted with AES-256-GCM (`ENCRYPTION_KEY`). Only the last 4 digits are kept in clear text, and only users who can edit employees can reveal the full number (this is audited). Only the last 4 digits of Aadhaar are stored.
- Invite tokens are random, stored only as SHA-256 hashes, and expire after 7 days.
- CSV exports guard against spreadsheet formula injection.
- Uploads are limited to PDF, PNG, JPG and WebP files of 10 MB or less.

## Things to confirm before go-live

- **Holidays:** the demo seed's festival dates are placeholders. Load your official state holiday list.
- **Leave policy defaults** (CL 7, SL 7, EL 18 monthly with 30 carry forward): HR should confirm them against your policy and the Shops and Establishments Act for your state.
- **Two-factor sign-in:** not in Phase 1. Better Auth's two-factor plugin is the planned route.
