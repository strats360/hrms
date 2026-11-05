/** Thin fetch wrapper for the HRMS API. Sends the session cookie and active tenant. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let activeTenant: string | null = null;
try {
  activeTenant = localStorage.getItem("tenantId");
} catch {
  /* storage blocked */
}

export function setActiveTenant(id: string | null) {
  activeTenant = id;
  try {
    if (id) localStorage.setItem("tenantId", id);
    else localStorage.removeItem("tenantId");
  } catch {
    /* ignore */
  }
}
export const getActiveTenant = () => activeTenant;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (activeTenant) headers["X-Tenant-Id"] = activeTenant;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: "include" });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = data?.error ?? data;
    throw new ApiError(res.status, err?.message ?? `Request failed (${res.status})`, err?.code, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>("PATCH", p, b),
  put: <T>(p: string, b: unknown) => request<T>("PUT", p, b),
  del: <T>(p: string) => request<T>("DELETE", p),
  upload: <T>(p: string, fd: FormData) => request<T>("POST", p, fd),
};

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

/** Download a file (CSV export) from the API using the session. */
export async function download(path: string, fallbackName: string) {
  const headers: Record<string, string> = {};
  if (activeTenant) headers["X-Tenant-Id"] = activeTenant;
  const res = await fetch(`/api${path}`, { headers, credentials: "include" });
  if (!res.ok) {
    let msg = "Download failed";
    try {
      msg = (await res.json()).error.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}
