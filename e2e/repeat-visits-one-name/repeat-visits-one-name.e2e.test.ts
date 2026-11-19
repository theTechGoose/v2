/**
 * REQ-1148 — AMENDMENT of REQ-743 (LOOP-007 cycle 3, q3-79), on the real shell. The sidebar and
 * /field/subscriptions call them "Repeat visits / Visitas repetidas", but the customer page said
 * "Recurring / Start recurring service / servicio recurrente" and Settings → Edit your details
 * said "every subscription / cada suscripción". In EN and ES: the customer page's More menu and
 * its repeat-visits tab use the house name and never "recurring / recurrente", and the Settings
 * net-days hint never says "subscription / suscripción".
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions, JSON_HEADERS } from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
) {
  const phone = `+1512${digits()}`;
  // the backend can still be booting when the front end answers (host load): wait for it
  let r: Response;
  let body: { recoverable?: boolean; recoveryToken?: string; error?: string };
  for (let i = 0;; i++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable" || i >= 90) break;
    await new Promise((res) => setTimeout(res, 2_000));
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "Repeat Visits Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: lang, domain, path: "/" },
  ]));
  return auth;
}

const CASES = [
  {
    lang: "en" as const,
    house: /repeat visit/i,
    stale: /recurring|subscription/i,
    staleSettings: /subscription/i,
  },
  {
    lang: "es" as const,
    house: /visitas? repetidas?/i,
    stale: /recurrente|suscripci/i,
    staleSettings: /suscripci/i,
  },
];

for (const c of CASES) {
  Deno.test(`REQ-1148 q3-79: in ${c.lang}, the customer page and Settings call them repeat visits — never recurring or subscription`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const auth = await signIn(http, page, baseUrl, c.lang);
      await answerQuestions(http, auth);
      const r = await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: `Rosa Repeat ${digits()}` }),
      });
      const ana = await r.json();
      if (!r.ok) throw new Error(`POST /api/customers → ${r.status} ${JSON.stringify(ana)}`);

      // every check is collected, so one run shows every stale name at once
      const problems: string[] = [];
      const near = (text: string, re: RegExp) =>
        text.match(new RegExp(`.{0,40}(${re.source}).{0,40}`, "i"))?.[0];
      const check = (ok: boolean, msg: string) => {
        if (!ok) problems.push(msg);
      };

      // (1) the customer page: overview, the More menu, and the repeat-visits tab
      await page.goto(`/customers/${ana.id}`);
      const ws = page.locator(`[data-cy='customer-workspace'][data-customer='${ana.id}']`);
      await ws.waitFor({ timeout: 20_000 });
      const overview = (await ws.textContent()) ?? "";
      check(!c.stale.test(overview), `the overview says "${near(overview, c.stale)}"`);

      await page.locator("[data-cy='cws-more']").click();
      const start = page.locator("[data-cy='cws-start-service']");
      await start.waitFor({ timeout: 15_000 });
      const startText = (await start.textContent())?.trim() ?? "";
      check(c.house.test(startText) && !c.stale.test(startText), `More → start item reads "${startText}"`);
      await page.locator("[data-cy='cws-more']").click();

      const tab = page.locator("[data-cy='cws-tab-recurring']");
      const tabText = (await tab.textContent())?.trim() ?? "";
      check(c.house.test(tabText) && !c.stale.test(tabText), `the tab reads "${tabText}", not the sidebar's name`);
      await tab.click();
      await page.waitForFunction(
        () => document.querySelector("[data-cy='cws-tab-recurring']")?.getAttribute("aria-selected") === "true",
        undefined,
        { timeout: 15_000 },
      );
      const body = (await page.locator(".cws-body").textContent()) ?? "";
      check(c.house.test(body), `the repeat-visits tab body never names them repeat visits`);
      check(!c.stale.test(body), `the repeat-visits tab body says "${near(body, c.stale)}"`);

      // (2) Settings → Edit your details: the net-days hint
      await page.goto("/settings");
      const netDays = page.locator("[data-cy='settings-net-days']");
      await netDays.waitFor({ timeout: 20_000 });
      const hint = ((await netDays.locator("xpath=ancestor::label[1]").textContent()) ?? "").trim();
      check(!c.staleSettings.test(hint), `the Settings net-days hint says "${near(hint, c.staleSettings)}"`);
      check(c.house.test(hint), `the Settings net-days hint does not name repeat visits: "${hint}"`);

      expect(problems.length === 0, `${problems.length} stale name(s): ${problems.join(" | ")}`);
    }));
}
