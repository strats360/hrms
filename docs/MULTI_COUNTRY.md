# Multi country design

Saralix runs in India today. This is how we take it to the UAE, Saudi Arabia, Qatar, Kuwait, Oman, Bahrain, the UK, the USA and Canada without breaking what already works, and without the cost growing with every new country.

## The idea in three rules

1. **One codebase, never forked.** Every site runs the same build. Country rules live in modules inside that codebase and are switched on by settings. There are no country branches.
2. **One instance per data region.** An instance is a full copy of the app with its own database, file storage and keys. We split instances by where the data has to live, not strictly by country.
3. **A country pack for each legal entity.** Inside an instance, each company (legal entity) picks the country whose rules apply to it. A Dubai group with a Qatar branch lives on one instance and gets combined reports.

```
                    app.saralix.com  (control plane)
            login routing · platform console · billing
                 company directory only, no employee data
                                │
      ┌──────────────┬──────────┼──────────┬──────────────┐
in.saralix.com  gulf.saralix.com  sa.saralix.com  uk.saralix.com  us.saralix.com
   Mumbai DB       UAE, Qatar,      Saudi DB        London DB       US DB
                   Kuwait, Oman     (in Kingdom)
      │                 │                │               │               │
      └────────── same code, same version, different settings ───────────┘
                each entity picks a country pack: IN · AE · QA · KW · OM · SA · GB · US
```

## Instances

| Instance | Domain | Data lives in | Country packs allowed |
| --- | --- | --- | --- |
| India | `in.saralix.com` (today `app.saralix.com`) | Mumbai | IN |
| Gulf | `gulf.saralix.com` | Closest allowed region, confirm with legal advice | AE, QA, KW, OM, BH |
| Saudi | `sa.saralix.com` | Inside Saudi Arabia | SA |
| UK | `uk.saralix.com` | London | GB |
| USA | `us.saralix.com` | US | US |
| Canada | `ca.saralix.com` | Canada | CA |

Rules for instances:
- Each instance has its own GitHub environment, Neon (or other Postgres) project, R2 bucket, Hyperdrive, Worker and secrets. A problem in one can't reach another.
- Updates roll out in waves: India first, then the others. An instance can be held back for a few days, never for long. Database changes stay additive, so old and new code both work during a rollout.
- The database layer must work with any Postgres provider, because Neon has no Gulf or Saudi region today.
- Adding an instance is configuration, not code: a new environment and its secrets.

## Control plane

A small central app, `apps/control`, at `login.saralix.com` for now (it moves to `app.saralix.com` when India moves to `in.saralix.com`):
- **Company directory:** which customer lives on which instance, their plan and status. Nothing about their employees.
- **Login routing:** one sign in page that sends people to their instance.
- **Platform console:** our staff see every customer across instances.
- **Billing:** one subscription system, with GST, VAT and ZATCA invoicing.

Until it exists, each instance keeps its own platform console, as India does today.

## What's global and what's per country

**Global core.** Built once, the same everywhere:
- Company and people: org structure, branches, employee records, documents, onboarding and exits, org chart, letter engine
- Time: attendance capture, shifts and rosters, timesheets
- Requests: leave engine with configurable types, approval chains, expense claims, loans, assets, helpdesk, announcements
- Talent: recruitment, performance, probation
- Payroll engine: runs, approvals, locking, payslips, payment batches. The rules come from the country pack.
- Platform: roles, 2FA, audit log, notifications, reports framework, privacy export and deletion, self service app, feature flags, billing, support

**Country pack.** One per country:
- Payroll rules, income tax, social insurance
- Statutory filings and reports
- End of service and final settlement
- Labour law defaults: minimum leave, overtime, working hours, notice and probation
- Holiday calendars and weekends
- Employee ID and document types, with expiry tracking
- Bank and salary file formats (WPS and others)
- Quotas such as Nitaqat and Emiratisation
- Currency, rounding and date formats
- Language and legal wording on payslips and letters
- Local privacy rules for consent, retention and transfers

## Data design

### Legal entities

A tenant (customer account) has one or more legal entities. India customers get one entity made from their current company details, so nothing changes for them.

| Field | Example |
| --- | --- |
| `country` | `IN`, `AE` (ISO 3166 two letters) |
| `currency` | `INR`, `AED`, `KWD` (ISO 4217) |
| `timeZone` | `Asia/Kolkata`, `Asia/Dubai` (IANA) |
| `registrations` | Per country: GSTIN, PAN, TAN in India; trade licence, MOHRE number, TRN in the UAE |
| `statutory` | Per country: which schemes apply and their registration numbers (EPF, ESI in India; GPSSA, WPS in the UAE) |
| `isDefault` | The entity new employees join unless HR picks another |

Each employee belongs to one entity. Payroll runs are per entity and month, because currency and rules differ.

### Country packs

A pack is a module under `packages/shared/src/packs/<code>/` that exports one object, registered in `packs/index.ts`. The payroll engine and the rest of the core only talk to this object, never to country rules directly.

| Part | What it provides |
| --- | --- |
| Basics | Name, currency, default time zone, weekend, locale, date format |
| Entity fields | Registration numbers the entity form asks for, with validation |
| Employee fields | ID numbers and document types, with which ones expire |
| Payroll | Salary components and defaults, employee deductions and employer contributions, income tax |
| End of service | Gratuity or end of service award, and final settlement lines |
| Leave and time | Statutory leave minimums, overtime rates, working hours |
| Holidays | Public holidays to suggest each year |
| Filings | The returns and reports the country needs, and how to build each |
| Payments | Bank and salary file formats |
| Rules | The statutory rule categories it reads from the rule table |

### Statutory rule table

The existing versioned rule table gains a `country` column. Rates and thresholds stay data, so a change in GOSI or National Insurance rates is an edit in the platform console, not a code change.

## How we test it

Golden payroll files live in `packages/shared/golden/`. To add a country's: write its cases (inputs and why each one is there), run `pnpm --filter @hrms/shared golden -- <CODE>` to fill in the figures, have the local expert check every case by hand, and fill in `signedOff`. When a law changes, run the same command, review the printed differences, and get the file signed off again (changed figures clear the old sign off).

- Every pack has **golden payroll tests**: real payslip examples signed off by a local payroll expert. They run on every change, so an India fix can't break UAE payroll.
- Each new country runs alongside a pilot customer's old payroll for two or three months before general launch.

## Cost

Cloudflare is one account for all instances. Neon is roughly $19 a month per production project to start, with free branches for staging. Five instances with staging start at about $150 to $300 a month and grow with use, not with the number of instances. The bigger cost is people: a local payroll expert per country, and the time to run several databases.

## Plan

**Phase 0. Decisions.** Owner: business
1. Confirm the instance list above. ✅ Agreed
2. Legal advice on data residency for Saudi Arabia and the UAE
3. A payroll expert for each launch country
4. A payment provider for billing outside India
5. The order to launch countries in

**Phase 1. Make the core country neutral.** India keeps working throughout. ✅ Done
1. Legal entities, with employees linked to an entity ✅ Settings › Legal entities. Each instance limits entity countries with the `ALLOWED_COUNTRIES` Worker variable (default `IN`), and only countries with a finished pack can be picked.
2. Money with currency everywhere, and rounding per currency (3 decimals for KWD and OMR) ✅ `fmtMoney` and `roundMoney` know each currency's symbol and decimals, money columns hold 3 decimals, and payslips round the way the country pack says (whole rupees in India). Each site sets its default currency with `DEFAULT_CURRENCY`, and the web app takes it from the company's default entity.
3. Company time zone in place of the hardcoded Indian time ✅ `todayLocal`, `toLocalDate`, `toLocalTime`, `localMinutes` and `zonedDateTime` work in any zone, daylight saving included. Each site sets its default with `DEFAULT_TIME_ZONE`. Attendance (punches, device imports, CSV imports, corrections, rosters) reads shift times in the employee's entity zone. Screens still show times in the site's zone; per entity display comes with the first site that mixes zones (Gulf).
4. Country driven ID and document types, with visa and permit expiry reminders ✅ Passports, visas, work permits, Emirates ID, labour card, Iqama, QID, Civil ID, resident card, NI number and SSN (`ID_TYPES`), offered by the entity's country. HR and the employee get one reminder per expiry date (180 days ahead for passports, 60 for visas and permits, 30 for local IDs), and HR has an Expiring IDs list. India's PAN, Aadhaar and UAN stay on the employee record.
5. Holiday calendars per country ✅ A holiday can be for one legal entity, and attendance, leave counting, comp off and the employee's holiday list follow the employee's entity. Packs suggest fixed date public holidays, and the first entity in a new country gets its own calendar.
6. Translation support, ready for Arabic and right to left layout ✅ `t()` in `apps/web/src/lib/i18n.ts` with English as the source and an Arabic dictionary for the menus and app frame. Arabic sets `dir="rtl"`; the layout uses logical classes (`ms-`, `pe-`, `text-start`) so it mirrors, and English text and numbers inside keep their order. The language switch shows for Gulf companies. Screens move to `t()` as each country launches, and every translation needs a native speaker's review.
7. The country pack interface ✅ `packages/shared/src/packs/types.ts`
8. India rules moved into the India pack, with every current test still passing ✅ Payroll statutory lines (EPF, ESI, PT, LWF, TDS), final settlement and entity registrations go through `packFor(country)`. Payroll reads each employee's entity. Still to move as each part is touched: filings and returns (ECR, ESI, 24Q, Form 16), bank file formats, tax declarations and the onboarding ID fields.
9. Database layer that works with any Postgres provider ✅ The app only needs Postgres 14 or later behind Hyperdrive. Nothing in the code is Neon specific; the deploy script accepts any provider's direct connection string and asks for `sslmode=require`.
10. Statutory rule table per country ✅ Rules carry a `country` (default IN), and payroll reads the rules for the country of the employees being paid.

**Phase 2. Running several instances** ✅ Done
1. Instance settings: name, region, domain, allowed packs ✅ `deploy/instances.json`, checked in CI. Deploy reads the site for its GitHub environment.
2. Wave rollouts across instances from one click ✅ The **Rollout** workflow: tests once, then each wave only after the one before passed, with sites that can be held.
3. Monitoring and alerts per instance ✅ The **Monitor** workflow: every 10 minutes, an `outage` issue (and optional Slack or Teams message) when a site stays down, closed on recovery, plus a version drift warning.
4. Backups and restore drills per instance ✅ Neon point in time restore, proven monthly by the **Restore drill** workflow (restore to an hour ago in a branch, check counts, time it, delete). Manual drill steps for other providers in DEPLOY.md.
5. Golden payroll tests for every pack in CI ✅ `packages/shared/golden/<COUNTRY>.json`: at least five real payslip cases per pack with every line written out, checked on every change and before every deploy. India has 11 cases, waiting for a payroll consultant's sign off.

**Phase 3. Control plane** ✅ Done (see the notes on billing)
1. Company directory ✅ Each site's `/api/control` (company level data only), token derived from one shared key.
2. Login routing ✅ `apps/control` at `login.saralix.com`: asks each site live, nothing stored, unknown emails see the site list.
3. Platform console across instances ✅ `/console` behind Cloudflare Access (token verified by the app): sites, versions, companies, revenue, CSV.
4. Central billing with GST, VAT and ZATCA ✅ for tax: each site's invoicing entity has a country, currency and tax number. India keeps GST (CGST and SGST, or IGST); the UAE and Oman charge 5% VAT, Saudi Arabia 15%, the UK 20%; Qatar, Kuwait and the USA add none; customers in another country are zero rated as an export of services. Saudi invoices carry ZATCA's QR code (e-invoicing phase 1). Still to do: ZATCA phase 2 (clearing invoices through Fatoora), a payment provider for currencies other than rupees (Cashfree is INR only), and confirming every rate and the export treatment with a tax advisor. Invoices stay on each site; the console adds them up by site and currency.

**Phase 4 onward. Country packs**, each with a pilot customer
1. UAE pack, then the Gulf instance ✅ for the pack, waiting on expert sign off. What's in it:
   - **Per entity payroll.** Each legal entity runs its own payroll every month, in its own currency. Pick the entity next to Run payroll. Runs before this change belong to the default entity.
   - **Pension.** GPSSA for UAE nationals (11% employee, 12.5% employer, on a contribution salary between AED 1,000 and 70,000). Abu Dhabi entities use ADPF instead (5% and 15%). Other GCC nationals get a warning to set up their home country's scheme. Set nationality on the employee record.
   - **No Indian rules.** PF, ESI, PT, TDS, PAN and minimum wage checks are off for UAE entities, and PF no longer comes out of the CTC.
   - **Gratuity** in the final settlement: 21 days of basic pay a year for the first five years, 30 after that, pro rata, capped at two years' pay.
   - **WPS file.** A locked UAE payroll downloads a salary information file (SIF) for the bank. It needs the MOHRE establishment ID and the bank routing code on the entity, plus each employee's MOHRE person code (IDs & visas), IBAN and routing code. If something is missing, you see exactly what.
   - **Emiratisation.** The Legal entities page shows each UAE entity's share of nationals against the current and next target.
   - **IDs.** Emirates ID, MOHRE person code, health insurance and ILOE, with expiry reminders.
   - Still to do: golden cases signed off by a UAE payroll expert (`packages/shared/golden/AE.json`), the rates in the statutory master UI (they live in code with notes to confirm), and the Gulf site itself (see `deploy/instances.json`).
2. Saudi pack and the Saudi instance
3. Qatar, Kuwait, Oman and Bahrain packs
4. UK pack, then HMRC recognition
5. USA: HR core, with payroll tax through a partner
6. Canada: federal and provincial income tax, CPP or QPP, EI, ROE and T4 (or a payroll partner, as for the USA)

Compliance details for each country are a starting point only. Every pack needs sign off from a local expert before it pays anyone.
