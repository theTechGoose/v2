/**
 * REQ-1140 (LOOP-007 q3, q3-71) — a signed job leaves the customer's Jobs tab at 0.
 *
 * QA saw /customers/<id>?tab=jobs read "Jobs 0 … No work orders yet" (es "Trabajos 0 … Todavía no
 * hay órdenes de trabajo.") while the /customers board said "Active 1" / "1 signed job in flight"
 * for the same customer. The story signs Q-001 as the customer (public accept, no session), opens
 * her Jobs tab in en and es and expects: the tab badge reads the card's activeJobs (1), the tab
 * links to the signed quote Q-001, and no "no work orders" empty state is shown.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

type Lang = "en" | "es";

async function signedJob(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: Lang,
) {
  const phone = `+1512${digits()}`;
  // the runner waits for the front end only; a cold backend (--watch boot) answers backend_unreachable
  let r: Response;
  let body: Record<string, unknown> = {};
  for (let i = 0;; i++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable" || i >= 90) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, { method, headers: auth, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  await call("/api/me", { name: "Marcus Reyes", email: `owner${digits()}@example.com`, language: lang }, "PUT");
  await call("/api/profile/identity", { businessName: "Reyes Remodeling", commsLanguage: lang }, "PUT");
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );

  const customer = await call("/api/customers", { name: "Lucia Herrera" });
  const quote = await call("/api/quotes", {
    customerId: customer.id,
    summary: "Kitchen backsplash",
    jobName: "Kitchen backsplash",
    lineItems: [{ description: "Kitchen backsplash", quantity: 1, unit: "job", price: 240_000 }],
    estimatedTotal: 240_000,
    terms: [{ stepId: "payment_terms", value: "Due Now" }],
    status: "draft",
  });
  await call(`/api/quotes/${quote.id}`, { status: "sent" }, "PUT");
  // the customer signs on her own device (no session)
  const accept = await http(`/api/quotes/${quote.id}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Lucia Herrera", signature: SIGNATURE_PNG }),
  });
  await accept.body?.cancel();
  if (accept.status >= 400) throw new Error(`accept: ${accept.status}`);

  const wsRes = await http(`/api/customers/${customer.id}/workspace`, { headers: auth });
  if (!wsRes.ok) throw new Error(`workspace → ${wsRes.status}`);
  const ws = await wsRes.json();
  return { customerId: customer.id as string, quoteId: quote.id as string, activeJobs: ws.customer.activeJobs as number };
}

const NONE: Record<Lang, string> = {
  en: "No work orders yet.",
  es: "Todavía no hay órdenes de trabajo.",
};

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1140 (LOOP-007 q3, q3-71) ${lang.toUpperCase()}: after the customer signs Q-001, /customers/<id>?tab=jobs counts 1 job like the board, links to Q-001 and shows no "no work orders" empty state`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const s = await signedJob(http, page, baseUrl, lang);
      expect.eq(s.activeJobs, 1, "the board's card counts one signed job in flight (REQ-562)");

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/customers/${s.customerId}?tab=jobs`);
      await page.locator(`[data-cy='customer-workspace'][data-customer='${s.customerId}']`).waitFor({ timeout: 20_000 });
      const tab = page.locator("[data-cy='cws-tab-jobs']");
      await tab.waitFor({ timeout: 20_000 });

      // read every correlated fact in one evaluate (one render)
      const seen = await page.evaluate((quoteId: string) => {
        const tab = document.querySelector("[data-cy='cws-tab-jobs']");
        const badge = tab?.querySelector(".cws-tab__n")?.textContent?.trim() ?? "";
        const body = document.querySelector(".cws-body")?.textContent ?? "";
        const link = [...document.querySelectorAll<HTMLAnchorElement>(".cws-body a")].find((a) =>
          a.getAttribute("href") === `/quotes?open=${quoteId}`
        );
        return { badge, body, linkText: link?.textContent?.trim() ?? null };
      }, s.quoteId);

      expect.eq(seen.badge, String(s.activeJobs), `the Jobs tab badge reads the board's active job count (got "${seen.badge}")`);
      expect(
        !seen.body.includes(NONE[lang]),
        `the Jobs tab does not say "${NONE[lang]}" for a customer with a signed job in flight`,
      );
      expect(seen.linkText !== null, `the Jobs tab links to the signed quote (/quotes?open=${s.quoteId})`);
      expect(
        (seen.linkText ?? "").includes("Q-001"),
        `the signed job's link names Q-001 (got ${JSON.stringify(seen.linkText)})`,
      );
    }));
}
