import { assert, assertEquals } from "@std/assert";
import { App } from "fresh";
import type { State } from "../utils.ts";
import { handler as adminGate } from "../routes/admin/_middleware.ts";

/**
 * REQ-376 (demo-loop cycle 2, issues m20 + nc-second-demo) — integration: the real /admin
 * middleware in a Fresh app, the backend answered in process (/me, /admin/whoami,
 * /demo-mode/active) the way mod.ts publishes it on Deno Deploy. A session that is impersonating
 * (a demo started in another tab of the same browser) hitting /admin gets an interstitial that
 * says whom this browser is guiding — never a bare 302 to the customer's /dashboard; the staff's
 * own session still reaches the console, a plain customer still goes to /dashboard.
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
  businessName: "Torres Roofing",
  superAdmin: false,
  language: "es",
  createdAt: 0,
  updatedAt: 0,
};
const staff = {
  id: "s1",
  name: "Hans",
  phoneNumber: "+18435550101",
  superAdmin: true,
  language: "en",
  createdAt: 0,
  updatedAt: 0,
};
const demo = {
  role: "presenter",
  session: {
    id: "demo_1",
    presenterName: "Hans",
    targetName: "Ana Torres",
    targetUserId: "c1",
    presenters: [{ userId: "s1", name: "Hans", color: "#2f6d29" }],
  },
  targetPath: null,
  pid: "p1",
};
const noDemo = { role: null, session: null, targetPath: null, pid: null };

type Who = "impersonating" | "staff" | "customer";
function backend(who: Who, active: unknown, staffLang = "en"): Fetch {
  return (req) => {
    const path = new URL(req.url).pathname;
    const me = who === "staff" ? staff : customer;
    if (path === "/me") return json(me);
    if (path === "/admin/whoami") {
      return json({
        authenticated: true,
        user: me,
        superAdmin: me.superAdmin,
        impersonating: who === "impersonating",
        impersonator: who === "impersonating"
          ? { ...staff, language: staffLang }
          : null,
      });
    }
    if (path === "/demo-mode/active") return json(active);
    return json({ name: "NotFound" }, 404);
  };
}

async function hitAdmin(fetcher: Fetch, cookie = "pm_session=sess_1") {
  const prev = g.__backendFetch;
  g.__backendFetch = fetcher;
  try {
    const app = new App<State>()
      .use(adminGate)
      .get("/admin", () => new Response("ADMIN CONSOLE"));
    const res = await app.handler()(
      new Request("http://app/admin", { headers: { cookie } }),
    );
    return { res, body: await res.text() };
  } finally {
    g.__backendFetch = prev;
  }
}

Deno.test("REQ-376 /admin while this browser guides a customer: an interstitial naming them, Back to the demo + Return to your account — not a bare 302 to their /dashboard", async () => {
  const { res, body } = await hitAdmin(backend("impersonating", demo));
  assertEquals(res.status, 200, "an explanation, not a redirect");
  assertEquals(res.headers.get("location"), null);
  assert(!body.includes("ADMIN CONSOLE"), "the console is not served");
  assert(
    body.includes("You are guiding Ana Torres in this browser"),
    `names the customer: ${body.slice(0, 400)}`,
  );
  assert(body.includes('data-cy="admin-gate"'));
  assert(
    /data-cy="admin-gate-back"[^>]*href="\/demo\/stage"|href="\/demo\/stage"[^>]*data-cy="admin-gate-back"/
      .test(body),
    "Back to the demo goes to the stage",
  );
  assert(body.includes('data-cy="admin-gate-return"'));
  assert(body.includes("Return to your account"));
  assert(
    body.includes("start another demo"),
    "says how to start another demo",
  );
});

Deno.test("REQ-376 the interstitial speaks the presenter's language (es), not the customer's", async () => {
  const { body } = await hitAdmin(backend("impersonating", demo, "es"));
  assert(
    body.includes("Estás guiando a Ana Torres en este navegador"),
    body.slice(0, 400),
  );
});

Deno.test("REQ-376 an impersonation with no demo: the interstitial offers Return only, no Back to the demo", async () => {
  const { res, body } = await hitAdmin(backend("impersonating", noDemo));
  assertEquals(res.status, 200);
  assert(body.includes('data-cy="admin-gate-return"'));
  assert(!body.includes('data-cy="admin-gate-back"'));
});

Deno.test("REQ-376 the staff's own session still reaches the console; a plain customer still goes to /dashboard; no session goes home", async () => {
  const own = await hitAdmin(backend("staff", noDemo));
  assertEquals(own.res.status, 200);
  assertEquals(own.body, "ADMIN CONSOLE");

  const plain = await hitAdmin(backend("customer", noDemo));
  assertEquals(plain.res.status, 302);
  assertEquals(plain.res.headers.get("location"), "/dashboard");

  const none = await hitAdmin(backend("customer", noDemo), "");
  assertEquals(none.res.status, 302);
  assertEquals(none.res.headers.get("location"), "/");
});
