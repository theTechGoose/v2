import { assert, assertEquals } from "@std/assert";
import { App } from "fresh";
import type { State } from "../utils.ts";
import type { PageProps } from "fresh";
import type { FunctionComponent } from "preact";
import * as terms from "../routes/terms.tsx";
import { legalPathFor } from "../../shared/legal/terms.ts";

const TERMS = legalPathFor("terms");

/**
 * REQ-510 (demo-loop cycle 3, issue m35) — integration: the real /terms route
 * (publicPageHandler + LegalPage) in a Fresh app, the backend answered in
 * process the way mod.ts publishes it on Deno Deploy. A signed-in visitor sees
 * "Back to app" → /dashboard in the header, not "Log in"; a visitor with no
 * session cookie sees Log in, and the backend is never asked (cookie-gated).
 */
type Fetch = (req: Request) => Response | Promise<Response>;
const g = globalThis as { __backendFetch?: Fetch };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const user = {
  id: "u1",
  name: "Ana Torres",
  phoneNumber: "+15125550101",
  language: "en",
  createdAt: 0,
  updatedAt: 0,
};

async function hitTerms(fetcher: Fetch, cookie?: string) {
  const prev = g.__backendFetch;
  let meCalls = 0;
  g.__backendFetch = (req) => {
    if (new URL(req.url).pathname === "/me") meCalls++;
    return fetcher(req);
  };
  try {
    const app = new App<State>().route(TERMS, {
      handler: terms.handler,
      // the page reads the data the handler set; App.route types it as unknown
      component: terms.default as FunctionComponent<
        PageProps<unknown, State>
      >,
    });
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    const res = await app.handler()(
      new Request(`http://app${TERMS}?lang=en`, { headers }),
    );
    return { res, body: await res.text(), meCalls };
  } finally {
    g.__backendFetch = prev;
  }
}

const header = (body: string) =>
  body.slice(body.indexOf('class="nav-wrap"'), body.indexOf('class="legal"'));

Deno.test("REQ-510 m35 /terms signed in: the header says Back to app → /dashboard, not Log in", async () => {
  const { res, body } = await hitTerms(
    (req) =>
      new URL(req.url).pathname === "/me"
        ? json(user)
        : json({ name: "NotFound" }, 404),
    "pm_session=sess_1",
  );
  assertEquals(res.status, 200);
  const h = header(body);
  assert(h.includes('href="/dashboard"'), h);
  assert(h.includes("Back to app"), h);
  assert(!h.includes('href="/login"'), `no Log in link: ${h}`);
});

Deno.test("REQ-510 m35 /terms with an expired session: Log in, as for any visitor", async () => {
  const { res, body } = await hitTerms(
    () => json({ name: "UnauthorizedError" }, 401),
    "pm_session=stale",
  );
  assertEquals(res.status, 200);
  assert(header(body).includes('href="/login"'));
});

Deno.test("REQ-510 m35 /terms with no session cookie: Log in, and the backend is not asked", async () => {
  const { res, body, meCalls } = await hitTerms(() => json(user));
  assertEquals(res.status, 200);
  const h = header(body);
  assert(h.includes('href="/login"'), h);
  assert(!h.includes("Back to app"));
  assertEquals(meCalls, 0, "no /me lookup without a session cookie");
});
