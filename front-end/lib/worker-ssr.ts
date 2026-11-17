/**
 * REQ-714 — demo-loop cycle 5, issue m58 ("worker view flashes English
 * first"). The /worker route reads the signed-in worker on the server, the
 * way the island's workerClient.me() does on the client (GET
 * /field/worker/me behind the pm_worker cookie), so the SSR page already
 * speaks the worker's language instead of painting the browser's pm_lang and
 * flipping once the client fetch returns.
 *
 * Server-only and dependency-free on purpose: the backend's integration test
 * imports it straight against the real FieldWorkerController.
 */
type WorkerLang = "en" | "es";
type Fetch = (req: Request) => Response | Promise<Response>;

/** the backend's worker-session cookie (WorkerSessionStore's WORKER_COOKIE) */
export const WORKER_SESSION_COOKIE = "pm_worker";

/** The pm_worker token from a Cookie header (`;`- or HTTP/2 `,`-joined), or undefined. */
export function readWorkerCookie(
  cookieHeader: string | null | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(/[;,]/)) {
    const [k, ...rest] = part.trim().split("=");
    if (k === WORKER_SESSION_COOKIE) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return undefined;
}

/** In process on Deno Deploy (mod.ts publishes the backend), else BACKEND_URL over HTTP. */
function defaultFetch(): Fetch {
  const inProcess = (globalThis as { __backendFetch?: Fetch }).__backendFetch;
  if (inProcess) return inProcess;
  return (req) => fetch(req);
}

function backendBase(inProcess: boolean): string {
  if (inProcess) return "http://internal";
  return (typeof Deno !== "undefined"
    ? Deno.env.get("BACKEND_URL")
    : undefined) ??
    "http://localhost:3000";
}

/**
 * The signed-in worker's language for this request, or null: no pm_worker
 * cookie (no backend call), signed out, an unknown language, or the backend
 * failing — the route then keeps its usual order and the client still applies
 * the worker's language after its own fetch (REQ-285).
 */
export async function loadWorkerLang(
  req: Request,
  opts: { fetch?: Fetch } = {},
): Promise<WorkerLang | null> {
  const token = readWorkerCookie(req.headers.get("cookie"));
  if (!token) return null;
  const inProcess = !opts.fetch &&
    !!(globalThis as { __backendFetch?: Fetch }).__backendFetch;
  const send = opts.fetch ?? defaultFetch();
  try {
    const res = await send(
      new Request(`${backendBase(inProcess)}/field/worker/me`, {
        method: "GET",
        headers: {
          accept: "application/json",
          cookie: `${WORKER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
        signal: AbortSignal.timeout(3000),
      }),
    );
    const text = await res.text();
    if (!res.ok || !text) return null;
    const who = JSON.parse(text) as { language?: unknown } | null;
    const l = who && typeof who === "object" ? who.language : null;
    return l === "en" || l === "es" ? l : null;
  } catch {
    return null;
  }
}
