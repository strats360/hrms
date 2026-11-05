import type { Env } from "../env";

/**
 * File storage on Cloudflare R2. Falls back to an in-memory store when no
 * bucket is bound (local Node tests).
 */
const memory = new Map<string, { body: ArrayBuffer; type: string }>();

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export async function putFile(env: Env, key: string, body: ArrayBuffer, contentType: string) {
  if (env.FILES) {
    await env.FILES.put(key, body, { httpMetadata: { contentType } });
  } else {
    memory.set(key, { body, type: contentType });
  }
}

export async function getFile(env: Env, key: string): Promise<{ body: ReadableStream | ArrayBuffer; type: string } | null> {
  if (env.FILES) {
    const obj = await env.FILES.get(key);
    if (!obj) return null;
    return { body: obj.body, type: obj.httpMetadata?.contentType ?? "application/octet-stream" };
  }
  return memory.get(key) ?? null;
}

export async function deleteFile(env: Env, key: string) {
  if (env.FILES) await env.FILES.delete(key);
  else memory.delete(key);
}

export function safeName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
}
