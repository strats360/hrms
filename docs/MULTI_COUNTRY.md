# Multi country design

Saralix runs in India today. This is how we take it to the UAE, Saudi Arabia, Qatar, Kuwait, Oman, the UK and the USA without breaking what already works, and without the cost growing with every new country.

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
| Gulf | `gulf.saralix.com` | Closest allowed region, confirm with legal advice | AE, QA, KW, OM |
| Saudi | `sa.saralix.com` | Inside Saudi Arabia | SA |
| UK | `uk.saralix.com` | London | GB |
| USA | `us.saralix.com` | US | US |

Rules for instances:
- Each instance has its own GitHub environment, Neon (or other Postgres) project, R2 bucket, Hyperdrive, Worker and secrets. A problem in one can't reach another.
- Updates roll out in waves: India first, then the others. An instance can be held back for a few days, never for long. Database changes stay additive, so old and new code both work during a rollout.
- The database layer must work with any Postgres provider, because Neon has no Gulf or Saudi region today.
- Adding an instance is configuration, not code: a new environment and its secrets.

## Control plane

A small central app at `app.saralix.com`:
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

A pack is a module under `packages/shared/src/countries/<code>/` that exports one object. The payroll engine and the rest of the core only talk to this object, never to country rules directly.

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

**Phase 1. Make the core country neutral.** India keeps working throughout.
1. Legal entities, with employees linked to an entity ✅ Settings › Legal entities. Each instance limits entity countries with the `ALLOWED_COUNTRIES` Worker variable (default `IN`), and only countries with a finished pack can be picked.
2. Money with currency everywhere, and rounding per currency (3 decimals for KWD and OMR)
3. Company time zone in place of the hardcoded Indian time
4. Country driven ID and document types, with visa and permit expiry reminders
5. Holiday calendars per country
6. Translation support, ready for Arabic and right to left layout
7. The country pack interface
8. India rules moved into the India pack, with every current test still passing
9. Database layer that works with any Postgres provider
10. Statutory rule table per country

**Phase 2. Running several instances**
1. Instance settings: name, region, domain, allowed packs
2. Wave rollouts across instances from one click
3. Monitoring and alerts per instance
4. Backups and restore drills per instance
5. Golden payroll tests for every pack in CI

**Phase 3. Control plane**
1. Company directory
2. Login routing
3. Platform console across instances
4. Central billing with GST, VAT and ZATCA

**Phase 4 onward. Country packs**, each with a pilot customer
1. UAE pack, then the Gulf instance
2. Saudi pack and the Saudi instance
3. Qatar, Kuwait and Oman packs
4. UK pack, then HMRC recognition
5. USA: HR core, with payroll tax through a partner

Compliance details for each country are a starting point only. Every pack needs sign off from a local expert before it pays anyone.
