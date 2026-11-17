import { assert, assertEquals } from "@std/assert";
import { App } from "fresh";
import type { FunctionComponent } from "preact";
import type { PageProps } from "fresh";
import type { State } from "../utils.ts";
import { ssrLangMiddleware } from "./ssr-lang.ts";
import { tFor } from "./i18n.ts";
import type { Lang } from "./lang.ts";
import * as dashboardMw from "../routes/dashboard/_middleware.ts";
import DashboardRoute from "../routes/dashboard/index.tsx";
import * as quotesMw from "../routes/quotes/_middleware.ts";
import QuotesRoute from "../routes/quotes/index.tsx";
import * as invoicesMw from "../routes/invoices/_middleware.ts";
import InvoicesRoute from "../routes/invoices/index.tsx";
import * as assistantMw from "../routes/assistant/_middleware.ts";
import AssistantRoute from "../routes/assistant/index.tsx";
import AssistantThreadRoute from "../routes/assistant/[threadId].tsx";
import * as accountsMw from "../routes/accounts-manager/_middleware.ts";
import AccountsManagerRoute from "../routes/accounts-manager/index.tsx";

/**
 * REQ-709 (demo-loop cycle 5, issue m4) — integration: the real app routes
 * (their auth middleware, the root ssr-lang middleware, the page) in a Fresh
 * app, the backend answered in process. An account whose language is "es"
 * opened /dashboard?lang=en: the islands and <html lang> said English
 * (resolveSsrLang honours ?lang=) but the route's own `lang` came from
 * user.language alone, so the tab read "Panel · DocuMonster" over an English
 * page (fleet-6 stdout:257). The same pattern was on /quotes, /invoices,
 * /assistant, /assistant/:id and /accounts-manager. REQ-592 fixed /admin only.
 *
 *   cd front-end && deno test -A lib/route-doc-title-lang.int.test.tsx
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

type Page = FunctionComponent<PageProps<unknown, State>>;
type Mw = { handler: Parameters<App<State>["use"]>[1] };

const ROUTES: {
  path: string;
  pattern: string;
  mw: Mw;
  page: unknown;
  title: (l: Lang) => string;
}[] = [
  {
    path: "/dashboard",
    pattern: "/dashboard",
    mw: dashboardMw as Mw,
    page: DashboardRoute,
    title: (l) =>
      tFor(l, "dashboardPage.docTitle", { brand: tFor(l, "brand.name") }),
  },
  {
    path: "/quotes",
    pattern: "/quotes",
    mw: quotesMw as Mw,
    page: QuotesRoute,
    title: (l) => tFor(l, "quotesPage.docTitle"),
  },
  {
    path: "/invoices",
    pattern: "/invoices",
    mw: invoicesMw as Mw,
    page: InvoicesRoute,
    title: (l) => tFor(l, "invoicesPage.docTitle"),
  },
  {
    path: "/assistant",
    pattern: "/assistant",
    mw: assistantMw as Mw,
    page: AssistantRoute,
    title: (l) => tFor(l, "assistantPage.docTitle"),
  },
  {
    path: "/assistant/t-1",
    pattern: "/assistant/:threadId",
    mw: assistantMw as Mw,
    page: AssistantThreadRoute,
    title: () => "",
  },
  {
    path: "/accounts-manager",
    pattern: "/accounts-manager",
    mw: accountsMw as Mw,
    page: AccountsManagerRoute,
    title: (l) => tFor(l, "accountsManager.docTitle"),
  },
];

async function hit(r: typeof ROUTES[number], query: string): Promise<string> {
  const prev = g.__backendFetch;
  g.__backendFetch = (req) =>
    new URL(req.url).pathname === "/me"
      ? new Response(JSON.stringify(owner), {
        headers: { "content-type": "application/json" },
      })
      : new Response(JSON.stringify({ name: "NotFound" }), { status: 404 });
  try {
    const app = new App<State>()
      .use(ssrLangMiddleware)
      .use(
        r.path.startsWith("/assistant") ? "/assistant" : r.pattern,
        r.mw.handler,
      )
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
  }
}

/** the <title> element's painted text and its per-language attributes */
function titleOf(body: string): { text: string; en: string; es: string } {
  const m = body.match(/<title([^>]*)>([^<]*)<\/title>/);
  assert(m, "no <title> rendered");
  // the painted text, HTML entities decoded ("Quotes & agreements", REQ-746)
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

/** the footer's rendered markup (island props carry both languages) */
function footerMarkup(body: string): string {
  const i = body.lastIndexOf("<footer");
  assert(i >= 0, "no footer rendered");
  return body.slice(i, body.indexOf("</footer>", i));
}

for (const r of ROUTES) {
  Deno.test(`REQ-709 (m4): ${r.path}?lang=en for an es account paints the tab title and footer in English`, async () => {
    const body = await hit(r, "?lang=en");
    const t = titleOf(body);
    assertEquals(t.text, t.en, `${r.path}?lang=en tab title`);
    if (r.title("en")) assertEquals(t.text, r.title("en"));
    assert(t.text !== t.es || t.en === t.es, `Spanish title: ${t.text}`);
    const footer = footerMarkup(body);
    assert(footer.includes("Policies"), footer);
    assert(!footer.includes("Políticas"), `Spanish footer: ${footer}`);
  });

  Deno.test(`REQ-709 (m4): ${r.path} without ?lang= still follows the account's es`, async () => {
    const body = await hit(r, "");
    const t = titleOf(body);
    assertEquals(t.text, t.es, `${r.path} tab title`);
    assert(footerMarkup(body).includes("Políticas"));
  });
}
