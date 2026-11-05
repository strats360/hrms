import type { Context } from "hono";
import type { AppEnv } from "../env";

/** Sign the user in via Better Auth and return `body` with the session cookie attached. */
export async function signInAndRespond(c: Context<AppEnv>, email: string, password: string, body: unknown) {
  const res = await c.get("auth").api.signInEmail({
    body: { email, password, rememberMe: true },
    headers: c.req.raw.headers,
    asResponse: true,
  });
  const out = c.json(body as object, 200);
  for (const cookie of res.headers.getSetCookie()) out.headers.append("Set-Cookie", cookie);
  return out;
}
