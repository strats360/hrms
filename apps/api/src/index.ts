import type { Env } from "./env";
import { buildApp } from "./app";
import { runScheduled } from "./services/jobs";
import { runHourly } from "./services/announcements";

const app = buildApp();
const HOURLY = "0 * * * *";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return app.fetch(req, env, ctx);
    // Everything else is the single-page app (Workers static assets, SPA fallback).
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response("Not found", { status: 404 });
  },
  /** Cron Triggers: the daily jobs at 10:00 IST, and an hourly run for scheduled announcements. */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(event.cron === HOURLY ? runHourly(env) : runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
