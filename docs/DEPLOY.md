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
| `PLATFORM_ADMIN_PASSWORD` | only for the first deploy that creates your platform admin (at least 10 characters). Delete it afterwards |

**Variables**

| Name | Example | Default |
| --- | --- | --- |
| `CUSTOM_DOMAIN` | `hrms.strats360.com` (production), `hrms-staging.strats360.com` | the `workers.dev` address |
| `EMAIL_FROM` | `Strats360 People <people@strats360.com>` | none (email off) |
| `WORKER_NAME` | `strats360-hrms` | `strats360-hrms`, or `strats360-hrms-staging` |

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

## Day-to-day operations

| Task | How |
| --- | --- |
| Deploy a change | Merge to the branch, then run **Deploy** for staging, then production |
| Undo a bad deploy | Actions › **Rollback** (code only; database migrations aren't undone) |
| Restore data | Neon › Branches › Restore, to a point in time. Restore into a new branch first and check it |
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
