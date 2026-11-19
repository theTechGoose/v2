import { assert, assertEquals } from "@std/assert";
import { App } from "fresh";
import type { FunctionComponent } from "preact";
import type { PageProps } from "fresh";
import type { State } from "../utils.ts";
import { ssrLangMiddleware } from "./ssr-lang.ts";
import { type Lang, tFor } from "./i18n.ts";
import * as commsMw from "../routes/communications/_middleware.ts";
import CommsRoute from "../routes/communications/index.tsx";
import * as messagesMw from "../routes/messages/_middleware.ts";
import MessagesRoute from "../routes/messages/index.tsx";
import * as reportsMw from "../routes/reports/_middleware.ts";
import ReportsRoute from "../routes/reports/index.tsx";
import * as hrMw from "../routes/hr/_middleware.ts";
import HrRoute from "../routes/hr/index.tsx";
import * as customersMw from "../routes/customers/_middleware.ts";
import CustomerRoute from "../routes/customers/[id].tsx";
import * as dashboardMw from "../routes/dashboard/_middleware.ts";
import DashboardRoute from "../routes/dashboard/index.tsx";

/**
 * REQ-977 (LOOP-007 cycle 1, q1-56) — integration: the real app routes (their
 * auth middleware, the root ssr-lang middleware, the page) in a Fresh app, the
 * backend answered in process. The tab title every signed-in page paints has
 * one format, "<Page> · DocuMonster", in both languages, and the pages the
 * sidebar names lead with the sidebar's label. At the tested commit:
 * /communications read "Phone"/"Teléfono", /messages "Outbox"/"Bandeja de
 * salida", /reports "Reports — DocuMonster", /hr "HR · Overview", the Spanish
 * /dashboard "Panel · DocuMonster" (sidebar "Inicio") and /customers/:id the
 * bare "Linda Pérez".
 *
 *   cd front-end && deno test -A lib/route-doc-title-format.int.test.tsx
 */
type Fetch = (req: Request) => Response | Promise<Response>;
const g = globalThis as { __backendFetch?: Fetch };

const owner = {
  id: "user-1",
  name: "Ana Owner",
  phoneNumber: "+15125550111",
  language: "es",
  createdAt: 0,
  updatedAt: 0,
};
const customer = {
  id: "c-1",
  name: "Linda Pérez",
  phone: "+15125550122",
  createdAt: 0,
  updatedAt: 0,
};

type Page = FunctionComponent<PageProps<unknown, State>>;
type Mw = { handler: Parameters<App<State>["use"]>[1] };

const BRAND = (l: Lang) => ` · ${tFor(l, "brand.name")}`;

const ROUTES: {
  path: string;
  base: string;
  pattern: string;
  mw: Mw;
  page: unknown;
  /** the tab must start with one of these (the sidebar's label) */
  lead: (l: Lang) => string[];
}[] = [
  {
    path: "/dashboard",
    base: "/dashboard",
    pattern: "/dashboard",
    mw: dashboardMw as Mw,
    page: DashboardRoute,
    lead: (l) => [tFor(l, "nav.home")],
  },
  {
    path: "/communications",
    base: "/communications",
    pattern: "/communications",
    mw: commsMw as Mw,
    page: CommsRoute,
    lead: (l) => [tFor(l, "nav.phone"), tFor(l, "nav.communications")],
  },
  {
    path: "/messages",
    base: "/messages",
    pattern: "/messages",
    mw: messagesMw as Mw,
    page: MessagesRoute,
    lead: (l) => [tFor(l, "nav.outbox")],
  },
  {
    path: "/reports",
    base: "/reports",
    pattern: "/reports",
    mw: reportsMw as Mw,
    page: ReportsRoute,
    lead: (l) => [tFor(l, "nav.reports")],
  },
  {
    path: "/hr",
    base: "/hr",
    pattern: "/hr",
    mw: hrMw as Mw,
    page: HrRoute,
    lead: () => [""],
  },
  {
    path: "/customers/c-1",
    base: "/customers",
    pattern: "/customers/:id",
    mw: customersMw as Mw,
    page: CustomerRoute,
    lead: (l) => [`${customer.name} · ${tFor(l, "nav.customers")}`],
  },
];

async function hit(r: typeof ROUTES[number], query: string): Promise<string> {
  const prev = g.__backendFetch;
  const prevFetch = globalThis.fetch;
  const backend: Fetch = (req) => {
    const p = new URL(req.url).pathname;
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), {
        headers: { "content-type": "application/json" },
      });
    if (p === "/me") return json(owner);
    if (p === "/customers/c-1") return json(customer);
    return new Response(JSON.stringify({ name: "NotFound" }), { status: 404 });
  };
  g.__backendFetch = backend;
  // lib/api.ts (clientsClient.get on /customers/:id) calls fetch over BACKEND_URL
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(backend(new Request(input, init)))) as typeof fetch;
  try {
    const app = new App<State>()
      .use(ssrLangMiddleware)
      .use(r.base, r.mw.handler)
      .route(r.pattern, { component: r.page as Page });
    const res = await app.handler()(
      new Request(`http://app${r.path}${query}`, {
        headers: { cookie: "pm_session=sess_1" },
      }),
    );
    assert(res.status === 200, `${r.path}${query}: status ${res.status}`);
    return await res.text();
  } finally {
    g.__backendFetch = prev;
    globalThis.fetch = prevFetch;
  }
}

/** the <title> element's painted text and its per-language attributes */
function titleOf(body: string): { text: string; en: string; es: string } {
  const m = body.match(/<title([^>]*)>([^<]*)<\/title>/);
  assert(m, "no <title> rendered");
  const decode = (v: string) =>
    v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const attr = (name: string) =>
    decode(m[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "");
  return {
    text: decode(m[2]),
    en: attr("data-title-en"),
    es: attr("data-title-es"),
  };
}

for (const r of ROUTES) {
  Deno.test(`REQ-977 (q1-56): ${r.path} paints '<Page> · DocuMonster' in EN and ES, led by its sidebar label`, async () => {
    const t = titleOf(await hit(r, ""));
    const bad: string[] = [];
    for (const l of ["en", "es"] as const) {
      const title = t[l];
      if (!title.endsWith(BRAND(l))) bad.push(`[${l}] "${title}" lacks "${BRAND(l)}"`);
      if (/ [—–] /.test(title)) bad.push(`[${l}] "${title}" uses a dash separator`);
      const leads = r.lead(l).map((p) => (p ? `${p} · ` : ""));
      if (!leads.some((p) => title.startsWith(p))) {
        bad.push(`[${l}] "${title}" should start with ${leads.map((p) => `"${p}"`).join(" or ")}`);
      }
    }
    assertEquals(bad, [], `${r.path} tab title`);
    // the es account's SSR paints the Spanish one
    assertEquals(t.text, t.es);
  });
}
