import type { Env } from "./env";
import { buildApp } from "./app";

const app = buildApp();

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return app.fetch(req, env, ctx);
    // Everything else is the single-page app (Workers static assets, SPA fallback).
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
