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
| Attendance | Web/mobile punch (with optional GPS), punch checks against each branch's office location (radius, with GPS accuracy allowed for) and office network (IPv4/IPv6 addresses and ranges): off, flag for HR, or block, with work from home exempt if you choose and any of your offices counting, WFH, a live today view, monthly register, correction requests with approval, manual entry, shifts and weekly offs, CSV export. Bulk upload from a spreadsheet or biometric software export (dry run first; DD-MM-YYYY or ISO dates, 12 or 24 hour times, P/A/HD/L/WFH codes; days in an approved payroll month are locked). Biometric devices push punches to a keyed API: first and last punch of the day become check-in and check-out, repeats are ignored, and days HR entered aren't changed. Employees can have a separate biometric ID |
| Leave | Leave types and accrual (yearly, monthly, prorated for joiners), balances, apply (self or on behalf), approve or reject with reason, cancel, holiday calendar, leave register export. Closing a leave year carries unused leave into next year's opening balance up to each type's carry-forward limit; the rest lapses or, for encashable types, is paid out. Only employees whose leave was tracked here that year are included, and it can be run again. Encashable leave can also be encashed during the year at basic / 26 a day, paid with the next payroll. Comp off: employees claim it from self-service for weekly offs and holidays they worked (a full shift earns a day, half a shift half a day, checked against their shift, the holiday calendar and attendance), within a claim window; the manager or HR approves and it's credited to the CO balance; unused comp off lapses on its expiry date in the daily job. HR can grant it directly |
| Self-service portal | Mobile-first: punch in/out, attendance history, leave, profile and documents |
| Platform console | A separate super admin area with tenant list, plan and status changes (suspend/reactivate), staff list and a cross-tenant audit log |
| Audit log | Changes to records, approvals, exports and views of full bank account numbers |

### Phase 2 (in progress)

**Payroll is built:**

| Area | What works |
| --- | --- |
| Salary structure | A standard template (Basic % of gross, HRA % of Basic, conveyance, medical, PF on full basic or capped) plus any number of named templates, for grades or field staff. Each template can add the company's own allowances (fixed ₹ a month or % of basic, each taxable or not and in ESI wages or not); they come out of gross before special allowance and are prorated with paid days. PF stays on basic. Employees are moved between templates in bulk. Salary revisions are effective-dated, with custom components and allowances per employee. Revisions can't backdate into a locked month |
| Payroll run | A 7-step wizard: payroll month, input checks (joiners, exits, revisions, missing bank or PAN), attendance and LOP, calculate, review, approve and lock, then payslips and the bank file |
| Overtime | Overtime recorded in attendance is listed per employee in the payroll review. Payroll edits the hours to what was approved and saves; it's paid at 2× the ordinary hourly rate (monthly gross / 26 days / 8 hours, configurable under Settings). Overtime is taxable and ESI wages, not PF wages. More than 50 hours in a month is flagged |
| Minimum wage | The statutory master holds each state's minimum wage, optionally by skill category (unskilled to highly skilled). Employees can be given a category. Payroll flags anyone whose full-month basic (or gross, by company setting) is below it, salary revisions warn when they go under it, and a "Minimum wage check" report lists everyone with the shortfall |
| Approval chains | Settings › Approval chains sets who approves leave and attendance corrections, in order: reporting manager, the manager's manager and HR. Long leave (over a set number of days) can have its own, longer chain. A request is approved after the last step and rejected at any; steps with nobody to fill them are skipped, the same person doesn't approve twice, and HR can step in at any step. Queues show who each request is with and only offer Approve to whoever's turn it is; the next manager is emailed. The default is a single manager step, as before |
| Two-factor sign-in | Anyone can turn it on from **Sign-in and security** (the name in the admin header, or the shield in self-service): scan a QR code into an authenticator app, confirm a code, and save 10 one-time backup codes. Sign-in then asks for a code after the password, with an option to trust the device for 30 days. The same page changes the password and lists signed-in devices. Under Settings › Admin users & access, a super admin can require it for admins or for everyone (only once they have it on themselves); people without it are sent to set it up before anything else. A super admin can reset it for someone who lost their phone, which also signs them out everywhere. People are emailed when it's turned on, off or reset |
| My salary (self-service) | Payslips › My salary shows employees their CTC (yearly and monthly), the monthly and yearly breakdown by component with the employer's PF and ESI, and an estimate of a full month's deductions and take-home, worked out the way payroll would this month (PF, ESI, PT and TDS from their tax declaration and pay so far this year). Past revisions show the change in rupees and percent. Revisions dated in the future stay hidden until they take effect, and HR's reasons are never shown. HR can hide the tab under Settings › Organization; payslips show either way |
| Notification settings | Nine optional emails (leave, comp off and claim decisions, payslip ready, returned salary payments, resignation updates, and the approver emails for leave, comp off and resignations). HR can turn any of them off for the whole company under Settings › Notifications, and each person can turn off the ones they don't want from their account page; the page only shows the approver emails to admins and managers. Sign-in and security emails, invitations, billing emails and anything HR sends on purpose (payslip PDFs, tax reminders) always go out. Managers are now also emailed when someone first applies for leave |
| Bank file export layout | Exporting a payment batch opens a dialog: pick HDFC ENet, ICICI CIB, generic CSV or your own layout, and see the first 3 rows before you download (account numbers are masked in the preview, never in the file). Your own layout sets the columns and their order, CSV, pipe or tab text, or Excel, the date format, a header row or none, and bank-safe names. It's saved for the company and can be a debit account's or batch's default format. The account number and amount are always required, and the duplicate guard still stops the export if two payments go to the same account for the same amount |
| Profile photos | Employees add or change their photo from their self-service profile, and HR from the employee's profile. The browser crops it to a square and shrinks it to 320 pixels before upload, so photos stay small. The server checks the file really is a JPG, PNG or WebP (up to 1 MB) and stores it in R2, replacing the old one. Photos show wherever an employee's initials did: the directory, profiles, approval queues, attendance, payments and the header. Only signed-in people in the same company can load them, and HR can choose under Settings › Organization to make photos HR-only |
| Org chart | Employees › Org chart draws the reporting tree from each employee's manager, with photos, team sizes and links to profiles. Managers with more than 6 direct reports show them as a grid; open a team to centre the chart on that manager, with a trail back to the top. Find a person jumps to them, a department can be highlighted, and there's a list view for phones. HR sees the whole company; a manager sees their own branch. People whose manager has left, or who have none set, show at the top, and a reporting loop can't hide anyone |
| Letter generator | Generate letter on an employee's profile fills a template in from their record: offer, appointment, experience, relieving, salary certificate and employment and address proof are built in. HR checks and edits the text, then downloads a PDF on the company letterhead (name, address, CIN and GSTIN, reference number, date, signatory) or saves it to the employee's documents, where they see it in self-service. Settings › Letter templates edits the wording (built-ins can be reset), adds the company's own templates, and sets the signatory; fields are inserted with a click, including pronouns from the gender on record and {{salary_table}} for the CTC breakdown. Salary details need payroll access, and anything not on record is flagged before you download |
| Selfie and location punch | Attendance › Policies can ask for a selfie at each punch (off, optional or required) and sets how long selfies are kept (30 to 365 days, 90 by default); a daily job deletes them after that. On a phone, Check in opens the front camera full screen while the location is found; the photo is a small square JPEG, and the server checks it really is an image. Check-in and check-out locations are kept separately. HR and the employee's manager see a camera or map icon in the Today view, which opens both selfies, times, map links (OpenStreetMap) and the distance from the office. If the camera is blocked or missing, the employee is told how to fix it, and can skip unless a selfie is required |
| Calculation | Pay prorated for paid days. LOP comes from approved attendance (absent = 1 day, half day = 0.5) and approved unpaid leave, and can be overridden per employee. Joiners and leavers are prorated |
| Statutory | PF 12% on wages capped at ₹15,000 (EPF/EPS split, EDLI, admin), ESI 0.75%/3.25% up to ₹21,000 gross, state Professional Tax and Labour Welfare Fund |
| TDS | Projects annual income from year-to-date actuals plus the current structure, under the new or old regime. Applies the 87A rebate with marginal relief, surcharge with marginal relief, and 4% cess. What's left is spread over the remaining months |
| Review | Register with exceptions, change versus last month, hold or release salary, one-time earnings and deductions (incentives, arrears, recoveries), CSV salary register |
| Controls | Maker-checker approval (whoever calculates can't approve, unless they're a super admin). Approval is blocked while attendance corrections are pending. Reopening needs a reason and isn't allowed after the bank file is exported. Everything is audited |
| Payslips | Published to self-service with an email to each employee. Real PDF payslips (generated on the server, A4, in the design's layout) for each employee, a ZIP of the whole month, and emailing each employee their PDF as an attachment (in batches; salaries on hold are left out, and nobody is sent twice). Data is snapshotted, so payslips never change after lock |
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
| 24Q and Form 16 | Quarterly return tracking with deducted vs deposited, a deductee annexure CSV for the return utility, and Form 16 (Part A summary + Part B) as a server-generated PDF per employee or a ZIP for everyone, provisional until March is locked. Employees download their own from self-service |

**Reimbursements are built:**

| Area | What works |
| --- | --- |
| Categories | Policy per category: limit per claim, day, month, trip or night, or a rate per km (fuel). GST capture, receipt-required threshold and approval chain (manager, finance, or manager then finance). The demo seed has the design's nine categories |
| Claims | Employees submit from self-service with receipts (PDF, PNG, JPG, WebP up to 10 MB, stored on R2). HR can file on behalf. Future dates, dates before joining and duplicates (same category, date and amount) are blocked |
| Approvals | Manager stage goes to the reporting manager (or straight to finance when there's none). Claims over the policy limit always get a finance review. Nobody approves their own claim. Rejection needs a reason and the employee gets an email. Bulk approve and reject from the queue |
| Payout | Approved claims join the next payroll run (final approval on or before the period end). They add to net pay and the bank file, not to gross, PF, ESI or TDS. Marking the run paid marks the claims paid. Held salaries release their claims to the next run |
| Reports | Queue with totals (waiting, approved unpaid, paid this month, GST input credit), history with filters and CSV export, claims column in the salary register and on the payslip |
| Access | Admins and finance see every claim. Managers see their direct reports. HR and payroll admins have read-only access. Finance approval needs claim approval plus payments approval |

**Exits and full & final settlement are built:**

| Area | What works |
| --- | --- |
| Starting an exit | HR starts a resignation, termination, retirement, end of contract, death or absconding case from Employees › Exits or the employee's profile. Employees can also resign from self-service; HR and their manager get an email, and HR accepts it with the last working day. The employee can withdraw until HR accepts |
| Notice period | Company default (30 days, 15 on probation) under Settings, changeable per exit. A resignation's notice shortfall is recovered at gross / 30 a day unless waived. A termination can pay the shortfall in lieu |
| Exit checklist | Assets returned, handover, access removed and no dues from finance. All of it is needed before approval |
| Settlement | Gratuity after 4 years 240 days (or on death): 15/26 × basic × completed years, part years over 6 months rounded up, capped at ₹20 lakh. Earned leave encashment at basic / 26 a day, with an override per leave type. Other earnings and recoveries, and TDS. The taxable part is shown. Warnings for an unapproved last-month payroll, open claims and pending payments |
| Approval | Maker-checker, like payroll. Needs the last working day passed, the checklist done and the figures unchanged since drafting. Can be reopened until it's paid |
| Payment | Pay through a one-line payment batch (normal approval and bank file); the exit closes when the payment is marked paid or reconciled. Or close it by hand for a cheque, cash, recovery from the employee, or nothing due. Closing marks the employee exited and takes the encashed leave off their balance |
| Letters | Settlement statement (with the employee's acknowledgement), relieving letter and experience letter, printable or saved as PDF |
| Access | HR and payroll only (managers can't see exits). People without payroll access see the process but not the money |

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
- Two-factor secrets and backup codes are encrypted with the auth secret. Wrong codes are rate limited, and a sign-in's code step expires after 10 minutes or 5 wrong tries. A reset is only allowed from the one company a login belongs to; people who sign in to several companies need platform support.

## Things to confirm before go-live

- **Holidays:** the demo seed's festival dates are placeholders. Load your official state holiday list.
- **Leave policy defaults** (CL 7, SL 7, EL 18 monthly with 30 carry forward): HR should confirm them against your policy and the Shops and Establishments Act for your state.
