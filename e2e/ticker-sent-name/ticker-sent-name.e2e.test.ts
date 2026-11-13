/**
 * REQ-476 — demo-loop cycle 3, issues p8-pair9-a ("Truncated chip
 * 'Cotización enviada a t…'") and p8-pair10-c ("Truncated 'Quote sent to
 * your…'").
 *
 * At 1280×720 the live-activity pill sits near its 220 px floor beside the
 * search box (REQ-406), and the "Quote sent" sentence was cut off with an
 * ellipsis. In a real browser, on /assistant and /dashboard, in English and
 * Spanish, the whole sentence is now readable inside the pill (it may wrap to
 * a second line), the search box still shows its whole placeholder, and the
 * pill's hover title is the full sentence.
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
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
    body: JSON.stringify({ language: lang, name: "Ticker Sent Story" }),
  });
  await me.body?.cancel();
  await answerQuestions(http, auth, { name: "Ticker Sent Story" });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
}

const CASES = [
  // The demo's two lines, and the named form the backend now sends.
  { lang: "en", sentence: "Quote sent to your client" },
  { lang: "en", sentence: "Quote sent to María García" },
  { lang: "es", sentence: "Cotización enviada a tu cliente" },
  { lang: "es", sentence: "Cotización enviada a María García" },
] as const;

for (const { lang, sentence } of CASES) {
  Deno.test(`REQ-476 (demo cycle 3, p8-pair9-a / p8-pair10-c): at 1280×720 the pill shows "${sentence}" whole, beside a search box that still fits its placeholder (/assistant and /dashboard)`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signIn(http, page, baseUrl, lang);
      await page.route("**/api/notifications?*", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: "n-sent-1",
            userId: "u",
            type: "quote_sent",
            title: sentence,
            read: false,
            createdAt: new Date(Date.now() - 5_000).toISOString(),
          }]),
        }));
      // REQ-726 (cycle 5, m6): the pill shows from 1500px only
      await page.setViewportSize({ width: 1500, height: 720 });
      for (const path of ["/assistant", "/dashboard"]) {
        await page.goto(path);
        await page.locator(".topbar__ticker-time").first().waitFor({
          state: "visible",
          timeout: 25_000,
        });
        // Let the slide-in animation settle.
        await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const item = document.querySelector<HTMLElement>(
            ".topbar__ticker .topbar__ticker-item",
          )!;
          const pill = document.querySelector<HTMLElement>(".topbar__ticker")!;
          const input = document.querySelector<HTMLInputElement>(
            ".topbar__search input",
          )!;
          const cs = getComputedStyle(input);
          const ctx = document.createElement("canvas").getContext("2d")!;
          ctx.font =
            `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const ir = item.getBoundingClientRect();
          const pr = pill.getBoundingClientRect();
          return {
            text: item.innerText.replace(/\s+/g, " ").trim(),
            clippedX: item.scrollWidth - item.clientWidth,
            clippedY: item.scrollHeight - item.clientHeight,
            insidePill: ir.top >= pr.top && ir.bottom <= pr.bottom,
            pillTitle: pill.title,
            need: Math.ceil(ctx.measureText(input.placeholder).width),
            have: input.clientWidth,
          };
        });
        const where = `${path} (${lang})`;
        expect.eq(m.text, sentence, `${where}: the pill carries the sentence`);
        expect(
          m.clippedX <= 1 && m.clippedY <= 1,
          `${where}: "${sentence}" is not cut off (overflow x=${m.clippedX}px y=${m.clippedY}px)`,
        );
        expect(m.insidePill, `${where}: the text stays inside the pill`);
        expect(
          m.pillTitle.includes(sentence),
          `${where}: the pill's hover title has the whole sentence ("${m.pillTitle}")`,
        );
        expect(
          m.have >= m.need,
          `${where}: the search box still shows its whole placeholder (${m.have}px for ${m.need}px)`,
        );
      }
    }));
}
