/**
 * REQ-508 — "fix every issue the demo found, loop until there are none." Demo-loop cycle 3,
 * issue m20 ("Heavy polling; the browser calls POST /api/cron/run-nudges on every /invoices
 * load"). The scheduled-invoice nudge sweep runs on the server's isolate timer now; opening
 * /invoices (twice) sends no cron request.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn({ http, page, baseUrl }: StoryTools) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const me = await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ language: "en", name: "Nudge Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

Deno.test("REQ-508 m20: loading /invoices sends no POST /api/cron/run-nudges", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    await signIn(tools);
    const cron: string[] = [];
    page.on("request", (req) => {
      const u = new URL(req.url());
      if (u.pathname.startsWith("/api/cron/")) {
        cron.push(`${req.method()} ${u.pathname}`);
      }
    });
    for (let i = 0; i < 2; i++) {
      await page.goto("/invoices");
      await page.locator("[data-cy='forecast-hero']").waitFor({
        timeout: 15_000,
      });
      await page.waitForTimeout(1_500);
    }
    expect.eq(cron.join(", "), "", "no cron request from the page");
  }));
