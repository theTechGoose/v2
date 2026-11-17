import { assertEquals } from "@std/assert";
import { handler as loginHandler } from "../routes/login.tsx";

/**
 * REQ-879 (demo-loop cycle dm5, issue m3) — integration: the real /login handler in a Fresh app,
 * the backend answered in process (GET /me) the way mod.ts publishes it on Deno Deploy. A stale
 * logged-out /login?next=… tab that sees the session come back (a login in another tab) goes to
 * `next`; a reload of it, or any visit with a live session, lands on that same `next` — never a
 * bare /dashboard — and a `next` that leaves the site is never followed.
 */
type Fetch = (req: Request) => Response | Promise<Response>;
const g = globalThis as { __backendFetch?: Fetch };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const customer = {
  id: "c1",
  name: "Ana Torres",
  phoneNumber: "+15125550101",
  superAdmin: false,
  language: "en",
  createdAt: 0,
  updatedAt: 0,
};
const backend = (signedIn: boolean): Fetch => (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/me") {
    return signedIn ? json(customer) : json({ name: "Unauthorized" }, 401);
  }
  return json({ name: "NotFound" }, 404);
};

async function hitLogin(
  fetcher: Fetch,
  search: string,
  cookie = "pm_session=sess_1",
) {
  const prev = g.__backendFetch;
  g.__backendFetch = fetcher;
  try {
    const req = new Request(`http://app/login${search}`, {
      headers: { cookie },
    });
    // deno-lint-ignore no-explicit-any
    const out: any = await (loginHandler as any).GET({
      req,
      state: {},
      url: new URL(req.url),
    });
    // a redirect is a Response; the sign-in page itself is Fresh's page() data
    if (out instanceof Response) {
      await out.body?.cancel();
      return { status: out.status, location: out.headers.get("location") };
    }
    return { status: out?.status ?? 200, location: null };
  } finally {
    g.__backendFetch = prev;
  }
}

Deno.test("REQ-879 /login?next=/quotes with a live session: back to /quotes, not /dashboard", async () => {
  const res = await hitLogin(backend(true), "?next=%2Fquotes");
  assertEquals(res.status, 302);
  assertEquals(res.location, "/quotes");
});

Deno.test("REQ-879 /login with a live session and no next, or a next off the site: /dashboard", async () => {
  for (
    const s of [
      "",
      "?next=%2F%2Fevil.com",
      "?next=https%3A%2F%2Fevil.com",
      "?next=%2Flogin",
    ]
  ) {
    const res = await hitLogin(backend(true), s);
    assertEquals(res.status, 302, s);
    assertEquals(res.location, "/dashboard", s);
  }
});

Deno.test("REQ-879 /login?next=/quotes without a session: the sign-in page itself", async () => {
  const none = await hitLogin(backend(false), "?next=%2Fquotes", "");
  assertEquals(none.status, 200);
  const dead = await hitLogin(backend(false), "?next=%2Fquotes");
  assertEquals(dead.status, 200);
});
