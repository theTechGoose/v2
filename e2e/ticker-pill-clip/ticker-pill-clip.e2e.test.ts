/**
 * REQ-542 — demo-loop cycle 4, issues m31 and m8.
 *
 * m31: the customer saw the live-activity pill as "● just now" with no
 * sentence. The sentence's entrance animation started at opacity 0, so any
 * tab where the animation did not run to its end showed an empty pill. Here
 * every animation on the page is paused, as in a throttled tab: the sentence
 * must still be fully opaque.
 *
 * m8: in Spanish at 1280 px the pill read "Carol Henderson aceptó tu
 * cotizaci… ahora mism" — the time was clipped at the pill's edge. The time
 * must sit wholly inside the pill and not be cut.
 *
 * m8 (email): the send dialog's email preview was clipped on the right. The
 * real send-preview HTML, shown in a 340 px frame (narrower than the dialog
 * on a phone), must not scroll sideways.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
) {
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
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "Ticker Clip" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  return { auth };
}

const EVENT_ES = "Carol Henderson aceptó tu cotización de Baño principal";

for (const route of ["/dashboard", "/assistant"]) {
  Deno.test(`REQ-542 m31/m8: on ${route} the pill's sentence shows with animations paused, and the Spanish time is not clipped at 1280px or at the pill's 220px floor`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const { auth } = await signIn(http, page, baseUrl, "es");
      await answerQuestions(http, auth, { name: "Ticker Clip" });
      await page.route("**/api/notifications?*", (r) =>
        r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: "n-clip-1",
            userId: "u",
            type: "quote_accepted",
            title: EVENT_ES,
            titleKey: "notify.quote.acceptedJob",
            titleParams: { name: "Carol Henderson", job: "Baño principal" },
            read: false,
            createdAt: new Date(Date.now() - 5_000).toISOString(),
          }]),
        }));
      // A tab whose animations never advance (throttled / not painted).
      await page.addInitScript(() => {
        const s = document.createElement("style");
        s.textContent =
          "*,*::before,*::after{animation-play-state:paused!important}";
        document.addEventListener(
          "DOMContentLoaded",
          () => document.head.appendChild(s),
        );
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${route}?lang=es`);
      const time = page.locator(".topbar__ticker-time").first();
      await time.waitFor({ state: "attached", timeout: 25_000 });
      await page.waitForTimeout(600);

      const measure = () =>
        page.evaluate(() => {
          const pill = document.querySelector(".topbar__ticker")!;
          const item = document.querySelector(".topbar__ticker-item")!;
          const time = document.querySelector(".topbar__ticker-time")!;
          const p = pill.getBoundingClientRect();
          const tr = time.getBoundingClientRect();
          return {
            opacity: getComputedStyle(item).opacity,
            text: (item.textContent ?? "").replace(/\s+/g, " ").trim(),
            time: (time.textContent ?? "").trim(),
            timeLeft: tr.left,
            timeRight: tr.right,
            timeScroll: time.scrollWidth,
            timeClient: time.clientWidth,
            pillLeft: p.left,
            pillRight: p.right,
            border: parseFloat(getComputedStyle(pill).borderRightWidth) || 0,
          };
        });
      const check = async (where: string) => {
        const m = await measure();
        expect.eq(m.text, EVENT_ES, `${where}: the pill carries the sentence`);
        expect.eq(
          m.opacity,
          "1",
          `${where}: the sentence is opaque though its entrance never ran`,
        );
        expect.eq(
          m.time,
          "ahora mismo",
          `${where}: a fresh event says 'ahora mismo'`,
        );
        expect(
          m.timeRight <= m.pillRight - m.border + 0.5 &&
            m.timeLeft >= m.pillLeft,
          `${where}: the time sits wholly inside the pill (time ${m.timeLeft}..${m.timeRight}, pill ${m.pillLeft}..${m.pillRight})`,
        );
        expect(
          m.timeScroll <= m.timeClient,
          `${where}: the time is not cut (${m.timeScroll}px in ${m.timeClient}px)`,
        );
      };
      await check("at 1280px");
      // A crowded bar (a long greeting, the demo pill) squeezes the pill to
      // its 220px floor, where the demo saw "ahora mism": measure it there.
      await page.addStyleTag({
        content: ".topbar__ticker{max-width:220px!important}",
      });
      await page.waitForTimeout(300);
      await check("at the pill's 220px floor");
    }));
}

Deno.test("REQ-542 m8: the send dialog's email preview fits a 340px frame without scrolling sideways", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const post = async (path: string, body: unknown) => {
      const r = await http(path, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
      return json;
    };
    const customer = await post("/api/customers", {
      name: "Carmen Ruiz",
      email: "carmen@blackhole.postmarkapp.com",
    });
    const quote = await post("/api/quotes", {
      customerId: customer.id,
      summary: "Faucet repair and interior doors",
      jobName: "Faucet repair and interior doors",
      lineItems: [{
        description: "Faucet repair",
        quantity: 1,
        unit: "job",
        price: 25000,
      }],
      estimatedTotal: 25000,
      status: "draft",
    });
    const r = await http(
      `/api/quotes/${quote.id}/send-preview?channel=email&lang=en`,
      { headers: auth },
    );
    const preview = await r.json();
    const html: string = preview?.email?.html ?? "";
    expect(html.length > 0, "the preview carries the email's HTML");

    await page.goto(`${baseUrl}/login`);
    // The dialog's frame: ~353px inside the 420px send dialog; 340 is tighter.
    // setContent resolves on the page's load, which waits for the srcdoc.
    const attr = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    await page.setContent(
      `<iframe id="f" style="width:340px;height:600px;border:0" srcdoc="${attr}"></iframe>`,
      { waitUntil: "load" },
    );
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    await frame.waitForSelector(".pw-card, table", { timeout: 10_000 });
    const fit = await frame.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      // what pokes out, for the failure message
      over: [...document.querySelectorAll("body *")]
        .filter((e) => e.getBoundingClientRect().right > innerWidth)
        .map((e) => (e.textContent ?? "").trim().slice(0, 24))
        .slice(-4),
    }));
    expect(
      fit.scroll <= fit.client,
      `the email is no wider than its frame (${fit.scroll}px in ${fit.client}px; past the edge: ${
        JSON.stringify(fit.over)
      })`,
    );
  }));
