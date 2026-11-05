#!/bin/sh
set -e
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET is required}"
: "${ENCRYPTION_KEY:?ENCRYPTION_KEY is required}"
APP_URL="${APP_URL:-http://localhost:8787}"

echo "Waiting for Postgres..."
until (cd packages/db && node -e "require('postgres')(process.env.DATABASE_URL,{max:1,connect_timeout:3})\`select 1\`.then(()=>process.exit(0),()=>process.exit(1))") 2>/dev/null; do sleep 1; done

echo "Applying migrations..."
pnpm --filter @hrms/db migrate

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "Loading demo data (skipped if it already exists)..."
  (cd apps/api && npx tsx scripts/seed.ts)
fi

# wrangler reads secrets/vars for local dev from .dev.vars
cat > apps/api/.dev.vars <<VARS
DATABASE_URL=$DATABASE_URL
APP_URL=$APP_URL
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENVIRONMENT=${ENVIRONMENT:-development}
${RESEND_API_KEY:+RESEND_API_KEY=$RESEND_API_KEY}
${EMAIL_FROM:+EMAIL_FROM=$EMAIL_FROM}
VARS

# Point the Hyperdrive binding at the container database
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$DATABASE_URL"
cd apps/api
exec npx wrangler dev --local --ip 0.0.0.0 --port 8787 --persist-to /data/wrangler --var "APP_URL:$APP_URL" --var "ENVIRONMENT:${ENVIRONMENT:-development}"
