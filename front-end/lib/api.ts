/**
 * Thin isomorphic fetch wrapper around the Danet backend.
 *
 * - Server-side (SSR routes, middlewares): pass `sessionId` from the request cookie
 *   so requireUser() in the backend resolves the user. Falls back to the
 *   `BACKEND_URL` env (set by serve.ts) when running on the server.
 * - Client-side (islands): no sessionId argument; the browser's `pm_session`
 *   cookie is sent automatically (same-origin via Fresh proxy routes under /api/*).
 *
 * Zero business logic — these helpers serialize the request, attach the session
 * header, parse the JSON response, and surface errors. Anything domain-specific
 * lives behind a method on a per-page client (see clients/*.ts).
 */

const SERVER_BACKEND_URL = (typeof Deno !== "undefined"
  ? Deno.env.get("BACKEND_URL")
  : undefined) ?? "http://localhost:3000";

/** Public backend URL the BROWSER hits directly (cross-origin). Set via
 *  PUBLIC_BACKEND_URL env on the SSR side and inlined into the HTML by
 *  the page layout as `window.__PUBLIC_BACKEND_URL`. Falls back to
 *  same-origin /api so dev still works if the env isn't set. */
function clientBackendUrl(): string {
  const fromGlobal = (globalThis as { __PUBLIC_BACKEND_URL?: string }).__PUBLIC_BACKEND_URL;
  return (fromGlobal && fromGlobal.length > 0) ? fromGlobal.replace(/\/$/, "") : "/api";
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API ${status}`);
    this.status = status;
    this.body = body;
  }
}

export interface ApiOptions {
  /** Session id (server-side). On the client, the cookie is sent automatically. */
  sessionId?: string;
  /** Override base URL. Defaults to BACKEND_URL on server, "/api" on client. */
  baseUrl?: string;
  /** Query params object — values are stringified, undefineds dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** AbortSignal pass-through. */
  signal?: AbortSignal;
}

function isServer(): boolean {
  return typeof globalThis.window === "undefined";
}

function defaultBaseUrl(): string {
  return isServer() ? SERVER_BACKEND_URL : clientBackendUrl();
}

function buildUrl(path: string, opts: ApiOptions): string {
  const base = (opts.baseUrl ?? defaultBaseUrl()).replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  // Same-origin path prefix (e.g. "/api") on the client → return relative URL
  // so the browser hits the current origin (proxied through routes/api/* in
  // dev, served in-process on Deno Deploy). Absolute base on the client
  // (e.g. PUBLIC_BACKEND_URL=https://api.example.com) → return the full URL
  // so the request actually crosses origins. The previous version stripped
  // the host unconditionally, which silently turned any cross-origin base
  // into a same-origin no-prefix request — every API call 404'd if the env
  // var pointed anywhere other than "/api".
  const isAbsolute = /^https?:\/\//i.test(base);
  const url = new URL(base + p, isServer() || isAbsolute ? undefined : globalThis.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  if (isServer() || isAbsolute) return url.toString();
  return url.pathname + url.search;
}

async function request<T>(method: string, path: string, body: unknown, opts: ApiOptions): Promise<T> {
  const headers: Record<string, string> = {
    "accept": "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.sessionId) headers["x-session-id"] = opts.sessionId;

  const res = await fetch(buildUrl(path, opts), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
    signal: opts.signal,
  });

  const text = await res.text();
  let parsed: unknown = text;
  if (text.length > 0) {
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  }
  if (!res.ok) throw new ApiError(res.status, parsed, `${method} ${path} failed: ${res.status}`);
  return parsed as T;
}

export const api = {
  get:    <T>(path: string, opts: ApiOptions = {}): Promise<T> => request<T>("GET",    path, undefined, opts),
  post:   <T>(path: string, body?: unknown, opts: ApiOptions = {}): Promise<T> => request<T>("POST",   path, body, opts),
  put:    <T>(path: string, body?: unknown, opts: ApiOptions = {}): Promise<T> => request<T>("PUT",    path, body, opts),
  delete: <T>(path: string, opts: ApiOptions = {}): Promise<T> => request<T>("DELETE", path, undefined, opts),
};

/** Read `pm_session` from a Cookie header value. Returns undefined if absent. */
export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "pm_session") return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
