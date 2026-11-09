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

**Reimbursements are built:**

| Area | What works |
| --- | --- |
| Categories | Policy per category: limit per claim, day, month, trip or night, or a rate per km (fuel). GST capture, receipt-required threshold and approval chain (manager, finance, or manager then finance). The demo seed has the design's nine categories |
| Claims | Employees submit from self-service with receipts (PDF, PNG, JPG, WebP up to 10 MB, stored on R2). HR can file on behalf. Future dates, dates before joining and duplicates (same category, date and amount) are blocked |
| Approvals | Manager stage goes to the reporting manager (or straight to finance when there's none). Claims over the policy limit always get a finance review. Nobody approves their own claim. Rejection needs a reason and the employee gets an email. Bulk approve and reject from the queue |
| Payout | Approved claims join the next payroll run (final approval on or before the period end). They add to net pay and the bank file, not to gross, PF, ESI or TDS. Marking the run paid marks the claims paid. Held salaries release their claims to the next run |
| Reports | Queue with totals (waiting, approved unpaid, paid this month, GST input credit), history with filters and CSV export, claims column in the salary register and on the payslip |
| Access | Admins and finance see every claim. Managers see their direct reports. HR and payroll admins have read-only access. Finance approval needs claim approval plus payments approval |

**Payments are built:**

| Area | What works |
| --- | --- |
| Batches | Separate sections for salary, reimbursement, bonus and other payments. Salary comes from a locked payroll run, reimbursements from approved unpaid claims, bonus from the statutory bonus calculation (or pasted amounts), and other payments from a pasted list or one by one |
| Controls | Every batch starts as a draft and needs someone with payment approval rights to approve it (not the person who prepared it, unless they're a super admin). One live salary batch per payroll run. Same account and amount twice in a file is blocked. Possible repeat payments in the last 30 days are flagged |
| Bank files | HDFC ENet (CSV), ICICI CIB bulk (TXT) and a generic CSV, picked per debit account or per batch. NEFT, RTGS (₹2 lakh and above) or internal transfer is chosen from the IFSC. Account numbers are decrypted only to build the file |
| Reconciliation | Upload the bank's status file (CSV, pipe or tab) and payments are matched on reference, marked paid with the UTR or failed with the bank's reason. Or mark paid one by one, in bulk, or all at once |
| Failed payments | Failed and held payments across batches in one list. Retry keeps the same reference and picks up the employee's latest bank details, so the next file only has the retries. Employees get an email when a payment is returned |
| Payroll and claims | When a salary batch has no payments left pending, the payroll run is marked paid. Claims paid with salary are settled when that employee's salary payment clears. Claims in a reimbursement batch stay out of payroll |
| Reports | Paid and unpaid payments as CSV or Excel, filtered by type, status and date |
| Debit accounts | Company accounts with their file format, corporate client code and an optional balance for the dashboard |

**Reports are built:**

All 16 reports from the design, each as CSV or Excel (.xlsx, with extra sheets where useful) and a preview. Filters for period (month, quarter or financial year), branch, department and active or exited employees apply to every report. A report needs Reports access plus view rights on the module its data comes from, and downloading needs export rights.

| Group | Reports |
| --- | --- |
| People, attendance, leave | Employee master, employee attendance (daily punches), monthly attendance (with payroll paid days and LOP), leave register |
| Payroll and finance | Salary register, payroll summary by department and branch, payslip register with payment status, employee cost |
| Compliance and tax | PF (ECR), ESI, Professional Tax by state and slab, LWF, TDS |
| Expenses and payments | Reimbursements with a by-category sheet, bank payments with a per-payment sheet |
| Exits | Full and final settlement estimate: unpaid salary, leave encashment, gratuity and open claims |

**SaaS billing is built:**

| Area | What works |
| --- | --- |
| Plans | Starter, Growth and Enterprise from the design, priced per active employee per month, with a minimum seat count, employee limit and included admins. Platform super admins add and edit plans. Enterprise uses a contract rate set on the tenant |
| Billing run | Platform finance runs billing for a finished month. Each billable tenant gets one invoice for its active employees (at least the plan minimum). Trials, cancelled tenants and tenants without a price are skipped with a reason. Running it twice doesn't double-bill |
| GST invoices | Tax invoices with SAC 998314, CGST + SGST when the tenant is in the same state as the invoicing entity and IGST otherwise (from the GSTIN, or the state). Seller and buyer details are frozen on the invoice. Printable as PDF |
| Collections | Tenants can switch on autopay (UPI autopay or bank e-mandate via Cashfree Subscriptions): each new invoice under their limit is debited after the bank's pre-debit notice. A failed debit is retried once, 3 days later, by a daily scheduled job. A scheduled debit is withdrawn when the invoice is paid another way or voided, and tenants can skip one debit. Or they pay online with Cashfree (UPI, cards, netbanking): the invoice email has a "Pay online" link, and the invoice settles from Cashfree's signed webhook, checked against Cashfree's API. Platform finance can still record bank or cheque payments, send reminders and void unpaid invoices. A GSTR-1 CSV export for each month's invoices |
| Dunning | Reminders at 1, 7 and 15 days overdue, past due at 15 days (a banner for every tenant admin), suspension at 45 days. Platform finance reviews the list before running it. Paying the overdue invoice restores the account |
| Tenant view | Settings › Billing & invoices: plan, seats used, next invoice estimate, payment method, invoice history with PDFs, billing details and this month's usage |
| Platform settings | The invoicing entity: legal name, GSTIN, PAN, address, state, SAC, invoice prefix, payment terms, UPI and bank details |

**Before running real payroll, a payroll consultant or CA should confirm these:**
- **Tax slabs:** FY 2026-27 uses the FY 2025-26 slabs from Finance Act 2025. Update `TAX_TABLES` in `packages/shared/src/payroll.ts` if the Finance Act 2026 changed them.
- **State tables:** Professional Tax covers Gujarat, Maharashtra, Karnataka, West Bengal, Telangana, Andhra Pradesh and Madhya Pradesh (plus states with no PT). Labour Welfare Fund covers Gujarat and Maharashtra. Other states show a warning on the payslip.
- **CTC definition:** monthly CTC = gross + employer PF + employer ESI. PF admin and EDLI are shown as extra employer cost.
- **Old-regime TDS:** this counts only the standard deduction, employee PF (80C) and PT. Investment declarations, HRA exemption, previous-employer income and opening balances come with the TDS module. Until then, an employee's first month on the system annualises TDS and flags it.
- **Due dates:** EPF and ESI fall on the 15th, TDS on the 7th (30 April for March), PT by state (Gujarat 15th, Maharashtra month end, Karnataka 20th, West Bengal 21st) and LWF on 15 July / 15 January. Check the ESI file's reason codes against the ESIC portal.
- **Not in scope:** EPS age limit (58+), the ESI contribution-period rule, and mid-month salary revisions (the structure effective at month end is used).

- **Reimbursements as non-taxable:** claims are paid outside taxable salary on the basis that they are actual business expenses backed by bills. Fixed allowances (for example a flat mobile allowance without bills) should go into the salary structure instead.

- **Bank file layouts:** banks change the bulk upload columns per corporate client. Check the HDFC ENet and ICICI CIB layouts in `packages/shared/src/payments.ts` against the template your bank gives you, and test with a small file first.
- **Statutory bonus:** this uses basic pay as "wages", the ₹7,000 calculation ceiling (or the state minimum wage if higher, which you'd need to set), the ₹21,000 eligibility limit and at least 30 working days. Bonus paid through a payment batch doesn't deduct TDS.

- **Full and final settlement:** the report is an estimate (gratuity after 4 years 240 days at 15/26 of basic per year, leave encashment at basic / 26 for encashable leave). Notice-pay recovery, loans and other deductions need to be added by HR.

- **Statutory master:** the live versions seeded from the design match the built-in rules. Publishing a new version changes payroll from its effective month, so have your CA check each draft (for example the Karnataka PT revision and the Gujarat minimum wage) before you publish.
- **SaaS billing:** online payment uses Cashfree one-time checkout for each invoice. Autopay uses Cashfree Subscriptions (UPI autopay up to ₹15,000 per debit, eNACH above that), which Cashfree has to enable on your account. Check the Cashfree integration in sandbox before going live (docs/DEPLOY.md). GST e-invoicing (IRN) is needed once the platform's turnover crosses the threshold. Your CA should confirm the SAC code and invoice format.

**Phase 2 is complete.**

**Platform operations are built:**

| Area | What works |
| --- | --- |
| Support tickets | Tenant admins raise tickets from Help & support (area, priority, description, up to 3 attachments) and reply in a thread. The platform queue sorts P1 first and tracks first-response SLAs: P1 1 hour, P2 4 hours, P3 one business day. Assign owners, change status and priority, add internal notes the customer can't see. Both sides get email updates |
| Read-only support access | Only when the customer allows it on the ticket. Support opens a 60-minute session into that company: view-only for every module, no changes, and no downloads (exports, bank files, receipts, documents). Each visit is noted on the ticket and in the company's audit log, and it ends when the customer withdraws consent, the ticket is resolved, or time runs out |
| Statutory master | Versioned EPF, ESI, Professional Tax, LWF, income tax slabs and minimum wages with effective dates. Staff draft, super admins publish. Payroll, TDS projections, ECR and PT summaries use the versions in force for each month, falling back to the built-in rules. Tenants see what's in force under Compliance › Rules |
| Feature flags | Flags by plan, named tenants or percentage, with exclusions and a kill switch. Module flags gate the API and hide the screens. The seeded plan gates follow the pricing page: Starter has no TDS, claims or bank files | These show as "Soon" in the navigation.

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

The API tests rebuild the `hrms_test` database (`TEST_DATABASE_URL`, default `postgres://hrms:hrms@localhost:5432/hrms_test`), run migrations and the seed, then test real HTTP flows. That covers auth, tenant isolation, permissions, onboarding, leave, attendance, payroll, compliance, TDS and reimbursements.

## Deploying to Cloudflare + Neon

Production runs as one Cloudflare Worker (API and web app), with Neon Postgres in Mumbai behind Hyperdrive and files in R2. The **Deploy** GitHub workflow does everything: tests, migrations, reference data (plans, statutory master, feature flags; never demo data), the R2 bucket and Hyperdrive, the Worker and its secrets, and a smoke test. **Rollback** undoes a bad deploy.

You add the credentials to a `staging` and a `production` GitHub environment, then run the workflow. The step-by-step runbook, with the Cloudflare token permissions, Neon settings, secrets and day-to-day operations, is in [docs/DEPLOY.md](docs/DEPLOY.md).

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
