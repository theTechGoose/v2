import { assertEquals } from "@std/assert";
import { App } from "fresh";
import type { State } from "../utils.ts";
import { handler as dashboard } from "../routes/dashboard/_middleware.ts";
import { handler as quotes } from "../routes/quotes/_middleware.ts";
import { handler as invoices } from "../routes/invoices/_middleware.ts";
import { handler as payments } from "../routes/payments/_middleware.ts";
import { handler as clients } from "../routes/clients/_middleware.ts";
import { handler as customers } from "../routes/customers/_middleware.ts";
import { handler as assistant } from "../routes/assistant/_middleware.ts";
import { handler as settings } from "../routes/settings/_middleware.ts";
import { handler as messages } from "../routes/messages/_middleware.ts";
import { handler as communications } from "../routes/communications/_middleware.ts";
import { handler as reports } from "../routes/reports/_middleware.ts";
import { handler as tools } from "../routes/tools/_middleware.ts";
import { handler as contracts } from "../routes/contracts/_middleware.ts";
import { handler as workOrders } from "../routes/work-orders/_middleware.ts";
import { handler as wo } from "../routes/wo/_middleware.ts";
import { handler as accountsManager } from "../routes/accounts-manager/_middleware.ts";
import { handler as admin } from "../routes/admin/_middleware.ts";
import { handler as demo } from "../routes/demo/_middleware.ts";

/**
 * REQ-1153 (LOOP-007 cycle 3, q3-82) — integration: the real auth gates (`_middleware.ts`) in a
 * Fresh app, the backend answered in process (GET /me) the way mod.ts publishes it on Deno
 * Deploy. A visitor with no session who opens an app page — /dashboard, or an owner alert's
 * /quotes?open=<id> link — is sent to /login?next=<that page>, the same answer client.ts gives a
 * client-side 401 (P-35). Before the fix every gate answered a bare 302 to "/" (the marketing
 * home) and the page asked for was lost. A live session still passes straight through.
 */
type Fetch = (req: Request) => Response | Promise<Response>;
const g = globalThis as { __backendFetch?: Fetch };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const owner = {
  id: "u1",
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
    return signedIn ? json(owner) : json({ name: "Unauthorized" }, 401);
  }
  return json({ name: "NotFound" }, 404);
};

// deno-lint-ignore no-explicit-any
type Mw = any;
async function hit(mw: Mw, url: string, fetcher: Fetch, cookie = "") {
  const prev = g.__backendFetch;
  g.__backendFetch = fetcher;
  try {
    const app = new App<State>().use(mw).get("/*", () => new Response("PAGE"));
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    const res = await app.handler()(
      new Request(`http://app${url}`, { headers }),
    );
    const body = await res.text();
    return { status: res.status, location: res.headers.get("location"), body };
  } finally {
    g.__backendFetch = prev;
  }
}

const gates: Array<[string, Mw, string]> = [
  ["dashboard", dashboard, "/dashboard"],
  ["quotes", quotes, "/quotes?open=abc"],
  ["invoices", invoices, "/invoices/inv_1"],
  ["payments", payments, "/payments"],
  ["clients", clients, "/clients"],
  ["customers", customers, "/customers/c_9"],
  ["assistant", assistant, "/assistant?thread=t1"],
  ["settings", settings, "/settings"],
  ["messages", messages, "/messages"],
  ["communications", communications, "/communications"],
  ["reports", reports, "/reports"],
  ["tools", tools, "/tools/satellite"],
  ["contracts", contracts, "/contracts"],
  ["work-orders", workOrders, "/work-orders"],
  ["wo", wo, "/wo/w1"],
  ["accounts-manager", accountsManager, "/accounts-manager"],
  ["admin", admin, "/admin"],
  ["demo", demo, "/demo/stage?lang=en"],
];

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): no session on /dashboard → 302 /login?next=%2Fdashboard, not the marketing home '/'", async () => {
  const res = await hit(dashboard, "/dashboard", backend(false));
  assertEquals(res.status, 302);
  assertEquals(res.location, "/login?next=%2Fdashboard");
});

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): an owner alert's /quotes?open=abc with no session → 302 /login?next=%2Fquotes%3Fopen%3Dabc", async () => {
  const res = await hit(quotes, "/quotes?open=abc", backend(false));
  assertEquals(res.status, 302);
  assertEquals(res.location, "/login?next=%2Fquotes%3Fopen%3Dabc");
});

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): a session the backend no longer knows (401 on /me) is sent to /login?next= too", async () => {
  const res = await hit(
    quotes,
    "/quotes?open=abc",
    backend(false),
    "pm_session=stale",
  );
  assertEquals(res.status, 302);
  assertEquals(res.location, "/login?next=%2Fquotes%3Fopen%3Dabc");
});

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): every authed app gate sends a logged-out visitor to /login?next=<the page asked for>", async () => {
  const wrong: string[] = [];
  for (const [name, mw, url] of gates) {
    const res = await hit(mw, url, backend(false));
    const want = `/login?next=${encodeURIComponent(url)}`;
    if (res.status !== 302 || res.location !== want) {
      wrong.push(
        `${name}: ${url} → ${res.status} ${res.location} (want 302 ${want})`,
      );
    }
  }
  assertEquals(
    wrong,
    [],
    `gates still dropping the page asked for:\n${wrong.join("\n")}`,
  );
});

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): with a live session the same /quotes?open=abc passes the gate to the page", async () => {
  const res = await hit(
    quotes,
    "/quotes?open=abc",
    backend(true),
    "pm_session=sess_1",
  );
  assertEquals(res.status, 200);
  assertEquals(res.body, "PAGE");
});
