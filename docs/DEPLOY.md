# Production setup: Cloudflare + Neon

The app runs as one Cloudflare Worker that serves both the API and the web app. Neon Postgres sits behind Cloudflare Hyperdrive, and files (documents, receipts, logos) go in R2. Deploys run from GitHub Actions. You add the credentials to GitHub once, then each deploy is one click.

What the **Deploy** workflow does, every time:

1. Runs the type checks and the full test suite against a fresh Postgres.
2. Applies database migrations to Neon (forward-only).
3. Loads reference data: plans, the statutory master and plan feature flags. It only adds what's missing and never overwrites changes made in the platform console. Demo data is never loaded.
4. Builds the web app.
5. Creates or updates the R2 bucket and the Hyperdrive connection (`deploy/provision.mjs`). Hyperdrive query caching is turned off, so a screen never shows stale data right after a save.
6. Deploys the Worker, then sets its secrets.
7. Optionally creates the first platform admin.
8. Smoke-tests `/api/health?deep=1` (database, secrets, storage, email) and the login page, and writes the URL to the run summary.

Use **staging** first, then **production**. Each has its own GitHub environment, Neon branch, Worker, bucket and keys.

---

## 1. Accounts you need

| Service | Plan | Why |
| --- | --- | --- |
| Cloudflare | **Workers Paid** | The free plan's 10 ms CPU limit is too low for payroll runs and reports |
| Neon | Launch or higher for production (Free is fine for staging) | Always-on compute, longer point-in-time restore |
| Resend | Any | Invites, password resets, payslip and claim emails. Needs your sending domain verified |
| A domain on Cloudflare | Optional | For `hrms.yourcompany.com` instead of a `workers.dev` address |

## 2. Neon

1. Create a project in **AWS Asia Pacific (Mumbai)**, `aws-ap-south-1`, so data stays in India.
2. The default branch is production. Create a branch named `staging` for the staging environment.
3. For each branch, copy the **direct** connection string, not the one with `-pooler` in the host, and make sure it ends with `?sslmode=require`. Hyperdrive does its own pooling.
4. Under project settings, set the history retention (point-in-time restore) as long as your plan allows.

## 3. Cloudflare API token

Create a token (My Profile › API Tokens › Create custom token) with:

- Account › **Workers Scripts** › Edit
- Account › **Workers R2 Storage** › Edit
- Account › **Hyperdrive** › Edit
- Account › **Account Settings** › Read
- If you use a custom domain: Zone › **Workers Routes** › Edit and Zone › **DNS** › Edit, for that zone

Copy your **Account ID** from the right-hand side of the Workers & Pages overview.

## 4. Generate the app secrets

Run these on your own machine, separately for staging and production:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET (signs sessions)
openssl rand -base64 32   # ENCRYPTION_KEY (encrypts bank account numbers)
```

**Keep a copy of each environment's `ENCRYPTION_KEY` somewhere safe** (a password manager). If it's lost, stored bank account numbers can't be decrypted. Don't change it on a live database: everything encrypted with the old key would become unreadable.

## 5. GitHub environments

In the repository: Settings › Environments. Create `staging` and `production`. For production, add yourself under **Required reviewers**, so every production deploy needs an approval click.

On each environment, add:

**Secrets**

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | your account ID |
| `NEON_DATABASE_URL` | the direct connection string for that environment's Neon branch |
| `BETTER_AUTH_SECRET` | from step 4 |
| `ENCRYPTION_KEY` | from step 4 |
| `RESEND_API_KEY` | optional at first. Without it, nothing is emailed and the deploy shows a warning |
| `CASHFREE_APP_ID` | optional. Cashfree App ID (sandbox keys on staging, production keys on production) |
| `CASHFREE_SECRET_KEY` | optional. Cashfree Secret Key |
| `PLATFORM_ADMIN_PASSWORD` | only for the first deploy that creates your platform admin (at least 10 characters). Delete it afterwards |

**Variables**

| Name | Example | Default |
| --- | --- | --- |
| `CUSTOM_DOMAIN` | `hrms.strats360.com` (production), `hrms-staging.strats360.com` | the `workers.dev` address |
| `EMAIL_FROM` | `Strats360 People <people@strats360.com>` | none (email off) |
| `WORKER_NAME` | `strats360-hrms` | `strats360-hrms`, or `strats360-hrms-staging` |
| `CASHFREE_ENV` | `production` on production, `sandbox` on staging | `sandbox` |

## 6. Deploy

Actions › **Deploy** › Run workflow:

1. Environment `staging`, and your email in **platform_admin_email** for the first run. When it finishes, the run summary shows the URL. Sign in at `/login` with that email and the `PLATFORM_ADMIN_PASSWORD`, and you land in the platform console.
2. Check staging, then run it again with environment `production` (and the admin email, the first time).
3. Remove `PLATFORM_ADMIN_PASSWORD` from both environments.

From the platform console, create your first company under Tenants, or let companies sign up from the public onboarding page.

## 7. After the first production deploy

- **Email:** in Resend, add your sending domain and the DNS records it gives you (SPF, DKIM). Then set `RESEND_API_KEY` and `EMAIL_FROM` and deploy again.
- **Cloudflare security** (dashboard › your domain):
  - Security › WAF › Rate limiting: limit `/api/auth/*` and `/api/public/*` (for example 30 requests a minute per IP).
  - Turn on Bot Fight Mode.
  - SSL/TLS › Edge Certificates: turn on Always Use HTTPS and set Minimum TLS to 1.2.
- **Logs:** Workers & Pages › your Worker › Logs. Errors and slow requests show there (observability is on).

## Online payments with Cashfree

Tenants pay their subscription invoices from Settings › Billing & invoices, or from the "Pay online" link in the invoice email. They pay by UPI, card or netbanking on Cashfree's checkout. The invoice is marked paid as soon as Cashfree confirms it, and a past-due account is restored.

1. In the Cashfree merchant dashboard, use **Payment Gateway** (sandbox first). Under Developers › API Keys, copy the App ID and Secret Key into the environment's `CASHFREE_APP_ID` and `CASHFREE_SECRET_KEY` secrets. Set `CASHFREE_ENV`, then deploy.
2. Under Developers › Webhooks, add the webhook URL shown in the platform console (Platform settings › Payment gateway): `https://<your domain>/api/public/payments/cashfree/webhook`. Subscribe it to the payment success, failed and user-dropped events. Webhooks are verified with your Secret Key.
3. For production, Cashfree has to approve your account (KYC) and whitelist your domain for checkout (Developers › Whitelisting).
4. Test in sandbox: pay an invoice with Cashfree's test UPI ID or test cards, and check the invoice shows as paid with the Cashfree payment ID.
5. If you use the WAF rate limit on `/api/public/*`, exclude `/api/public/payments/` so Cashfree's webhook retries aren't blocked.

How it's kept safe:
- The order amount always equals the invoice total.
- A payment is applied only after the server asks Cashfree's API for the order status. The webhook only says which order to check, and its signature and timestamp must be valid.
- A paid amount that doesn't match isn't applied.
- Settling is idempotent, so retries can't double-record a payment.
- A payment that arrives for an invoice that's already paid or void is flagged in the audit log for a refund.
- The Secret Key lives only as a Worker secret.

### Autopay (Cashfree Subscriptions)

Tenants can switch on autopay under Settings › Billing & invoices. Each company has one on-demand mandate with a limit per invoice. Every billing run then schedules a debit for each new invoice under that limit, at least 26 hours ahead, so the bank's pre-debit notice goes out first. The invoice settles from the webhook, checked against Cashfree's API, and a failed debit emails the tenant. Platform finance can also charge again by hand from Billing & invoices › Charge via autopay.

**Automatic retry.** A failed debit is retried once, 3 days later. The Worker has a Cron Trigger (`30 4 * * *`, 10:00 IST) that picks up retries that are due, and the deploy sets it up for you. The retry is a normal autopay debit, so it also goes out 26 hours after the bank's pre-debit notice. The failure email tells the tenant when the retry will happen, and a second email confirms it. A retry that fails isn't retried again, and the tenant is asked to pay online. Guards against double charging:
- A retry is skipped if the invoice was paid or voided in the meantime, or the mandate is no longer active. The skip is logged in the audit log.
- Each retry is claimed before it's made, so overlapping cron runs can't charge twice.
- A repeated failure webhook doesn't plan a second retry.
- A manual charge, or cancelling autopay, replaces any pending automatic retry.

**Cancelling a scheduled debit.** A debit can be withdrawn until Cashfree sends it to the bank:
- It's withdrawn automatically when the invoice is paid online, recorded as paid by platform finance, or voided.
- The tenant can skip one debit under Settings › Billing & invoices › Skip this debit. Autopay stays on for later invoices.
- Platform finance can withdraw it from Billing & invoices › Withdraw autopay debit.
- Every withdrawal is in the audit log. A debit that's already with the bank can't be stopped. The app says so, flags it in the audit log, and if it goes through on a paid or void invoice, flags that payment for a refund.

The app cancels through `POST /subscriptions/{subscription_id}/payments/{payment_id}/manage` with `action: CANCEL` on the Subscriptions API. Check this in sandbox before going live: schedule a debit, pay the invoice online, and confirm the debit shows as cancelled in the Cashfree dashboard. If Cashfree's current API differs, the change is one function, `cancelSubscriptionPayment` in `apps/api/src/services/cashfree-subscriptions.ts`.

Cron runs show under Workers & Pages › your Worker › Logs (filter on "autopay retries").

1. Ask Cashfree to enable **Subscriptions** (UPI autopay and eNACH) on your account. It's a separate product from Payment Gateway, with its own approval.
2. In the Subscriptions section of the dashboard, add the same webhook URL and subscribe it to the subscription status and payment events.
3. Test in sandbox: set up a mandate, approve it with the sandbox flow, run billing for a month, then trigger a test debit from the Cashfree dashboard.

**Limits to explain to customers:** under RBI e-mandate rules, UPI autopay debits above ₹15,000 need the payer to approve each one, so the app only offers UPI autopay up to ₹15,000 a month. Larger invoices should use a bank e-mandate (eNACH), which needs net banking or a debit card to approve, and a day or two for the bank to activate.

The Subscriptions API version defaults to `2025-01-01` (`CASHFREE_SUBS_API_VERSION` to change it).

The API version defaults to `2023-08-01`. If Cashfree asks you to move to a newer version, set the `CASHFREE_API_VERSION` Worker variable after testing in sandbox.

## Day-to-day operations

| Task | How |
| --- | --- |
| Deploy a change | Merge to the branch, then run **Deploy** for staging, then production |
| Undo a bad deploy | Actions › **Rollback** (code only; database migrations aren't undone) |
| Restore data | Neon › Branches › Restore, to a point in time. Restore into a new branch first and check it |
| Rotate the Cashfree keys | Generate new keys in Cashfree, replace the two secrets and deploy |
| Rotate the Cloudflare or Resend key | Replace the GitHub secret and run Deploy |
| Rotate `BETTER_AUTH_SECRET` | Replace it and deploy. Everyone has to sign in again |
| Add a platform staff member | Run Deploy with their email in platform_admin_email and a temporary `PLATFORM_ADMIN_PASSWORD`, or use `pnpm --filter @hrms/api platform-admin` locally with the Neon URL |

**Migrations** are forward-only and run before the new code goes live. Keep schema changes additive (add columns or tables first, and remove old ones in a later release), so the previous version keeps working during a deploy or a rollback.

## Running the same steps by hand

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require"
pnpm install && pnpm db:migrate && pnpm --filter @hrms/api bootstrap && pnpm build
DEPLOY_ENV=production CUSTOM_DOMAIN=hrms.strats360.com node deploy/provision.mjs
cd apps/api && npx wrangler deploy -c wrangler.deploy.json
npx wrangler secret put BETTER_AUTH_SECRET -c wrangler.deploy.json   # and ENCRYPTION_KEY, RESEND_API_KEY
```

Use `node deploy/provision.mjs --dry-run` to see the generated Worker config without calling Cloudflare.
