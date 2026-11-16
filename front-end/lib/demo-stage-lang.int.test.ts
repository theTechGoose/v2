import { assert, assertEquals } from "@std/assert";
import { App } from "fresh";
import type { State } from "../utils.ts";
import { handler as demoGate } from "../routes/demo/_middleware.ts";
import AppShell from "../routes/_app.tsx";
import DemoStageRoute from "../routes/demo/stage.tsx";

/**
 * REQ-812 (demo-loop cycle dm1, issue p2) — integration: the real /demo middleware, the real app
 * shell (_app.tsx) and the real /demo/stage page in a Fresh app, the backend answered in process
 * (/me, /admin/whoami, /demo-mode/active) the way mod.ts publishes it on Deno Deploy. Under
 * impersonation /me is the CUSTOMER; a customer who switched to Spanish in an earlier demo must
 * not make the presenter's stage page half Spanish: <html lang>, the boot language and the tab
 * title follow the PRESENTER (whoami's impersonator), like the pill does (REQ-341).
 */
type Fetch = (req: Request) => Response | Promise<Response>;
const g = globalThis as { __backendFetch?: Fetch };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const customer = (language: "en" | "es") => ({
  id: "c1",
  name: "Maria Lopez",
  phoneNumber: "+15125550101",
  businessName: "Lopez Roofing",
  superAdmin: false,
  language,
  createdAt: 0,
  updatedAt: 0,
});
const staff = (language: "en" | "es") => ({
  id: "s1",
  name: "Alex",
  phoneNumber: "+18435550101",
  superAdmin: true,
  language,
  createdAt: 0,
  updatedAt: 0,
});
const noDemo = { role: null, session: null, targetPath: null, pid: null };

function backend(
  customerLang: "en" | "es",
  staffLang: "en" | "es" | null,
): Fetch {
  return (req) => {
    const path = new URL(req.url).pathname;
    const me = customer(customerLang);
    if (path === "/me") return json(me);
    if (path === "/admin/whoami") {
      return json({
        authenticated: true,
        user: me,
        superAdmin: false,
        impersonating: staffLang !== null,
        impersonator: staffLang ? staff(staffLang) : null,
      });
    }
    if (path === "/demo-mode/active") return json(noDemo);
    return json({ name: "NotFound" }, 404);
  };
}

async function stage(
  fetcher: Fetch,
  cookie = "pm_session=sess_1",
  url = "http://app/demo/stage",
) {
  const prev = g.__backendFetch;
  g.__backendFetch = fetcher;
  try {
    const app = new App<State>()
      // deno-lint-ignore no-explicit-any
      .appWrapper(AppShell as any)
      .use(demoGate)
      // deno-lint-ignore no-explicit-any
      .route("/demo/stage", { component: DemoStageRoute as any });
    const res = await app.handler()(
      new Request(url, { headers: { cookie } }),
    );
    return { res, html: await res.text() };
  } finally {
    g.__backendFetch = prev;
  }
}

const htmlLang = (html: string) =>
  /<html[^>]*\blang="([a-z]+)"/.exec(html)?.[1];
const title = (html: string) => /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1];

Deno.test("REQ-812 customer es + presenter en: the stage page is English throughout — <html lang='en'>, the English title, the boot language en", async () => {
  const { res, html } = await stage(backend("es", "en"));
  assertEquals(res.status, 200);
  assertEquals(htmlLang(html), "en", "<html lang> is the presenter's");
  assertEquals(title(html), "Demo mode · DocuMonster", "the tab title");
  assert(
    html.includes('window.__PM_LANG="en"'),
    "the boot language seeds the client with the presenter's en",
  );
});

Deno.test("REQ-812 customer en + presenter es: the stage page is Spanish throughout", async () => {
  const { html } = await stage(backend("en", "es"));
  assertEquals(htmlLang(html), "es");
  assertEquals(title(html), "Modo demo · DocuMonster");
  assert(html.includes('window.__PM_LANG="es"'));
});

Deno.test("REQ-812 no impersonation: the signed-in person's own language (es) — unchanged", async () => {
  const { html } = await stage(backend("es", null));
  assertEquals(htmlLang(html), "es");
  assertEquals(title(html), "Modo demo · DocuMonster");
});

Deno.test("REQ-812 no session still goes home", async () => {
  const { res } = await stage(backend("es", "en"), "");
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/");
});

/** REQ-829 (demo-loop cycle dm2, m7) — the presenter's live language rides the stage URL */
Deno.test("REQ-829 presenter es viewing /admin?lang=en: /demo/stage?lang=en is English throughout", async () => {
  const { html } = await stage(
    backend("es", "es"),
    "pm_session=sess_1; pm_lang=en",
    "http://app/demo/stage?lang=en",
  );
  assertEquals(htmlLang(html), "en", "<html lang> is the carried language");
  assertEquals(title(html), "Demo mode · DocuMonster");
  assert(html.includes('window.__PM_LANG="en"'));
});
