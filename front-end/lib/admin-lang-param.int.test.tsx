import { assert } from "@std/assert";
import { App } from "fresh";
import type { FunctionComponent } from "preact";
import type { PageProps } from "fresh";
import type { State } from "../utils.ts";
import { ssrLangMiddleware } from "./ssr-lang.ts";
import * as adminMw from "../routes/admin/_middleware.ts";
import AdminRoute from "../routes/admin/index.tsx";

/**
 * REQ-592 (demo-loop cycle 4, issue m5) — integration: the real /admin route
 * (its auth middleware, the root ssr-lang middleware, the page) in a Fresh app,
 * the backend answered in process. A staff member whose account says "es"
 * opened /admin?lang=en: the islands painted English (resolveSsrLang honours
 * ?lang=) but the page's own `lang` came from user.language alone, so the
 * footer and the document title started in Spanish under an English page
 * ("footer showed Políticas", fleet-0 stdout:55).
 *
 *   cd front-end && deno test -A lib/admin-lang-param.int.test.tsx
 */
type Fetch = (req: Request) => Response | Promise<Response>;
const g = globalThis as { __backendFetch?: Fetch };

const staff = {
  id: "staff-1",
  name: "Alex Staff",
  phoneNumber: "+15125550199",
  language: "es",
  superAdmin: true,
  createdAt: 0,
  updatedAt: 0,
};

async function hitAdmin(query: string): Promise<string> {
  const prev = g.__backendFetch;
  g.__backendFetch = (req) =>
    new URL(req.url).pathname === "/me"
      ? new Response(JSON.stringify(staff), {
        headers: { "content-type": "application/json" },
      })
      : new Response(JSON.stringify({ name: "NotFound" }), { status: 404 });
  try {
    const app = new App<State>()
      .use(ssrLangMiddleware)
      .use("/admin", adminMw.handler)
      .route("/admin", {
        component: AdminRoute as FunctionComponent<PageProps<unknown, State>>,
      });
    const res = await app.handler()(
      new Request(`http://app/admin${query}`, {
        headers: { cookie: "pm_session=sess_1" },
      }),
    );
    assert(res.status === 200, `status ${res.status}`);
    return await res.text();
  } finally {
    g.__backendFetch = prev;
  }
}

/** The footer's rendered markup (its island props carry both languages, so
 *  look only at what it painted). */
function footerMarkup(body: string): string {
  const i = body.lastIndexOf("<footer");
  assert(i >= 0, "no footer rendered");
  return body.slice(i, body.indexOf("</footer>", i));
}

Deno.test("REQ-592 (m5): /admin?lang=en for an es staff account paints the footer in English", async () => {
  const footer = footerMarkup(await hitAdmin("?lang=en"));
  assert(footer.includes("Policies"), footer);
  assert(!footer.includes("Políticas"), `Spanish footer: ${footer}`);
});

Deno.test("REQ-592 (m5): /admin without ?lang= still follows the account's es", async () => {
  const footer = footerMarkup(await hitAdmin(""));
  assert(footer.includes("Políticas"), footer);
});
