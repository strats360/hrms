/**
 * Field-level encryption for sensitive values (bank account numbers).
 * AES-256-GCM via WebCrypto, which exists in both Cloudflare Workers and Node 20+.
 *
 * Format: "v1:" + base64(iv[12] || ciphertext)
 * The key is a base64-encoded 32-byte secret (ENCRYPTION_KEY).
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function importKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    const raw = b64ToBytes(secret);
    if (raw.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    k = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function encryptField(plain: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv);
  buf.set(ct, iv.length);
  return "v1:" + bytesToB64(buf);
}

export async function decryptField(value: string | null | undefined, secret: string): Promise<string | null> {
  if (!value) return null;
  if (!value.startsWith("v1:")) return value; // legacy / plain value
  const key = await importKey(secret);
  const buf = b64ToBytes(value.slice(3));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
  return dec.decode(pt);
}

/** SHA-256 hex, used for hashing invite tokens before storing them. */
export async function sha256Hex(input: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(input)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToB64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
