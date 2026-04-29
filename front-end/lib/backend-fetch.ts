/**
 * SSR helper for hitting the backend without HTTP.
 *
 * On Deno Deploy the composed `mod.ts` exposes `backend.fetch` on
 * globalThis.__backendFetch — calling it directly avoids the public-URL
 * self-fetch (Deno Deploy returns 508 Loop Detected) AND avoids the
 * dev-only BACKEND_URL=http://localhost:3000 fallback that 500s in prod.
 *
 * Falls back to a real HTTP fetch via BACKEND_URL when the in-process
 * handler isn't published (i.e. local dev where backend is on :3000).
 */

type BackendFetch = (req: Request) => Response | Promise<Response>;

const BACKEND_URL = (typeof Deno !== "undefined"
  ? Deno.env.get("BACKEND_URL")
  : undefined) ?? "http://localhost:3000";

function getInProcess(): BackendFetch | undefined {
  return (globalThis as { __backendFetch?: BackendFetch }).__backendFetch;
}

/** GET a backend path on the SSR side. `path` must start with `/`. */
export async function ssrBackendGet<T = unknown>(path: string, headers: Record<string, string> = {}): Promise<{
  ok: boolean;
  status: number;
  data?: T;
  errorText?: string;
}> {
  const reqHeaders = new Headers({ accept: "application/json", ...headers });
  const inProcess = getInProcess();

  let res: Response;
  if (inProcess) {
    res = await inProcess(new Request(`http://internal${path}`, { method: "GET", headers: reqHeaders }));
  } else {
    res = await fetch(`${BACKEND_URL}${path}`, { method: "GET", headers: reqHeaders });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, errorText: text };
  }
  return { ok: true, status: res.status, data: await res.json() as T };
}
