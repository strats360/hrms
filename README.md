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

### Phase 2 (in progress)

**Payroll is built:**

| Area | What works |
| --- | --- |
| Salary structure | A company-wide template (Basic % of gross, HRA % of Basic, conveyance, medical, PF on full basic or capped). Salary revisions are effective-dated, with custom components per employee. Revisions can't backdate into a locked month |
| Payroll run | A 7-step wizard: payroll month, input checks (joiners, exits, revisions, missing bank or PAN), attendance and LOP, calculate, review, approve and lock, then payslips and the bank file |
| Calculation | Pay prorated for paid days. LOP comes from approved attendance (absent = 1 day, half day = 0.5) and approved unpaid leave, and can be overridden per employee. Joiners and leavers are prorated |
| Statutory | PF 12% on wages capped at ₹15,000 (EPF/EPS split, EDLI, admin), ESI 0.75%/3.25% up to ₹21,000 gross, state Professional Tax and Labour Welfare Fund |
| TDS | Projects annual income from year-to-date actuals plus the current structure, under the new or old regime. Applies the 87A rebate with marginal relief, surcharge with marginal relief, and 4% cess. What's left is spread over the remaining months |
| Review | Register with exceptions, change versus last month, hold or release salary, one-time earnings and deductions (incentives, arrears, recoveries), CSV salary register |
| Controls | Maker-checker approval (whoever calculates can't approve, unless they're a super admin). Approval is blocked while attendance corrections are pending. Reopening needs a reason and isn't allowed after the bank file is exported. Everything is audited |
| Payslips | Published to self-service with an email to each employee, printable or "Save as PDF" in the design's layout. Data is snapshotted, so payslips never change after lock |
| Bank file | CSV with full account numbers (decrypted only for this export). Held salaries and missing bank details are skipped, and duplicate account+amount is blocked |

**Statutory compliance is built:**

| Area | What works |
| --- | --- |
| Liabilities | Worked out automatically from each locked payroll: EPF (A/c 1, 2, 10 and 21), ESI, TDS, and Professional Tax and LWF for each state. Each has its due date and a paid, overdue or due-soon status |
| Payments | Record each payment with its challan number, TRRN or CIN, the amount (interest included) and a receipt on R2. Edits are audited |
| Return files | EPFO ECR 2.0 text file, ESI monthly contribution columns, PT slab summary, employee-wise TDS |
| Overview | Cards per statute, a filing calendar (including 24Q quarters and Form 16), a gratuity provision estimate, EDLI members and overtime hours |
| Rules | The rates and state tables in force, plus registrations from Settings |

**TDS declarations and Form 16 are built:**

| Area | What works |
| --- | --- |
| Computation statement | Full Form 16 Part B style statement for both regimes: HRA exemption u/s 10(13A), standard deduction, PT, 24(b) home loan interest (₹2 L cap), other income, previous employer, and Chapter VI-A deductions (80C with employee PF capped at ₹1.5 L, 80CCD(1B) ₹50,000, 80D by age, 80E, 80G, 80TTA ₹10,000). Payroll TDS uses it every month |
| Self-service | Choose a regime with a live comparison, declare investments, upload proofs, submit to HR, view the computation, download Form 16 |
| HR | TDS register, per-employee computation, regime switch on request, proof review, verify and lock (you can't verify your own), reminders by email |
| 24Q and Form 16 | Quarterly return tracking with deducted vs deposited, a deductee annexure CSV for the return utility, and Form 16 (Part A summary + Part B) as a printable PDF, provisional until March is locked |

**Before running real payroll, a payroll consultant or CA should confirm these:**
- **Tax slabs:** FY 2026-27 uses the FY 2025-26 slabs from Finance Act 2025. Update `TAX_TABLES` in `packages/shared/src/payroll.ts` if the Finance Act 2026 changed them.
- **State tables:** Professional Tax covers Gujarat, Maharashtra, Karnataka, West Bengal, Telangana, Andhra Pradesh and Madhya Pradesh (plus states with no PT). Labour Welfare Fund covers Gujarat and Maharashtra. Other states show a warning on the payslip.
- **CTC definition:** monthly CTC = gross + employer PF + employer ESI. PF admin and EDLI are shown as extra employer cost.
- **Old-regime TDS:** this counts only the standard deduction, employee PF (80C) and PT. Investment declarations, HRA exemption, previous-employer income and opening balances come with the TDS module. Until then, an employee's first month on the system annualises TDS and flags it.
- **Due dates:** EPF and ESI fall on the 15th, TDS on the 7th (30 April for March), PT by state (Gujarat 15th, Maharashtra month end, Karnataka 20th, West Bengal 21st) and LWF on 15 July / 15 January. Check the ESI file's reason codes against the ESIC portal.
- **Not in scope:** EPS age limit (58+), the ESI contribution-period rule, and mid-month salary revisions (the structure effective at month end is used).

**Still to come in Phase 2:** reimbursements, payments, reports and SaaS billing. These show as "Soon" in the navigation.

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

### Run with Docker (local preview)

This runs the whole stack with one command: Postgres, plus the Worker in `workerd` (the same runtime as Cloudflare) with local R2 storage, serving the built web app. On first start it applies migrations and loads the demo data.

```bash
docker compose up --build
# open http://localhost:8787 and sign in with a demo login (password Demo@12345)
```

- Set `SEED_DEMO=false` to start with an empty database, and create your company at `/signup`.
- The secrets in `docker-compose.yml` are dev-only defaults. Override `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` (`openssl rand -base64 32`) for anything shared.
- Emails print to the container log (`docker compose logs -f app`) unless you set `RESEND_API_KEY` and `EMAIL_FROM`.
- If your network intercepts TLS with a private CA, build with `docker build --secret id=ca,src=/path/to/ca.crt -t hrms-app .` and then run `docker compose up`.
- Reset everything with `docker compose down -v`.

This is for local preview and testing. Production runs on Cloudflare Workers + Neon (see Deploying).

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
