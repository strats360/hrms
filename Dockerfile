# syntax=docker/dockerfile:1.7
#
# Local, self-contained preview of the whole app: the Cloudflare Worker runs in
# workerd (wrangler dev --local) with local R2 emulation, serving the built React
# app and talking to Postgres. Production runs on Cloudflare + Neon (see README).
#
# If your network intercepts TLS with a private CA, pass it as a build secret:
#   docker compose build --secret id=ca,src=/path/to/ca.crt   (or see docker-compose.yml)
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH WRANGLER_SEND_METRICS=false CI=true
# workerd needs a system CA bundle; the slim image has none, so export Node's built-in
# Mozilla root store (no apt needed).
RUN mkdir -p /etc/ssl/certs && node -p "require('tls').rootCertificates.join('\\n')" > /etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
WORKDIR /app

# Install dependencies first (cached unless manifests change)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm install -g pnpm@10.28.0 && pnpm install --frozen-lockfile

# Build the web app into apps/web/dist (served by the Worker as static assets)
COPY . .
RUN pnpm --filter @hrms/web build

EXPOSE 8787
ENTRYPOINT ["/app/docker/entrypoint.sh"]
