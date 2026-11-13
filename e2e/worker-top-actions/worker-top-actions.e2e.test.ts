/**
 * REQ-612 — demo-loop cycle 4, demo issue p4-p8c: "'Sign out' wraps at phone
 * size". At 390 px the worker header (REQ-353 made it wrap) put the title, the
 * EN/ES pill and "Back to office" on the first row and dropped "Sign out"
 * alone onto the second. The two header actions belong together: on a phone
 * they share one row under the title, end-aligned, each on a single line.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const W = 390;
const H = 844;
const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function owner(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
): Promise<Record<string, string>> {
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
  await answerQuestions(http, auth, {
    name: "Hank Miller",
    businessName: "Miller Lawn Care",
  });
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang }),
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
  return auth;
}

const LABELS = {
  en: { office: "Back to office", logout: "Sign out" },
  es: { office: "Volver a la oficina", logout: "Salir" },
} as const;

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-612 p4-p8c (${lang}): at 390 px the worker header keeps "${LABELS[lang].office}" and "${LABELS[lang].logout}" together on one row, each on one line`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await page.setViewportSize({ width: W, height: H });
      const auth = await owner(http, page, baseUrl, lang);
      const cell = `843${digits()}`;
      const w = await http("/api/field/workers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name: "Carlos Ruiz",
          phoneNumber: cell,
          pin: "1234",
          language: lang,
        }),
      });
      expect(
        w.status === 201 || w.status === 200,
        `worker created (${w.status})`,
      );
      await w.body?.cancel();
      await page.goto(`/worker?lang=${lang}`);
      await page.locator("[data-cy='w-cell']").fill(cell);
      await page.locator("[data-cy='w-pin']").fill("1234");
      await page.locator("[data-cy='w-login']").click();
      await page.locator("[data-cy='w-logout']").waitFor({ timeout: 15_000 });
      await page.locator("[data-cy='w-office']").waitFor({ timeout: 15_000 });
      await expect.see(LABELS[lang].office);
      await expect.see(LABELS[lang].logout);
      const m = await page.evaluate(() => {
        const box = (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          const r = el.getBoundingClientRect();
          // how many line boxes the label's text occupies
          const range = document.createRange();
          range.selectNodeContents(el);
          const lines = new Set(
            [...range.getClientRects()].filter((q) => q.width > 0).map((q) =>
              Math.round(q.top)
            ),
          ).size;
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            lines,
          };
        };
        return {
          brand: box(".top .brand"),
          lang: box(".top .lang"),
          office: box("[data-cy='w-office']"),
          logout: box("[data-cy='w-logout']"),
        };
      });
      const r = (n: number) => Math.round(n);
      expect(
        Math.abs(m.office.top - m.logout.top) < 2,
        `${lang}: "${LABELS[lang].office}" and "${
          LABELS[lang].logout
        }" share one row (tops ${r(m.office.top)} vs ${r(m.logout.top)})`,
      );
      expect(
        m.office.top >= m.brand.bottom - 0.5 &&
          m.office.top >= m.lang.bottom - 0.5,
        `${lang}: the actions row sits under the title and EN/ES (office top ${
          r(m.office.top)
        }, brand bottom ${r(m.brand.bottom)}, pill bottom ${r(m.lang.bottom)})`,
      );
      expect(
        m.office.right <= m.logout.left + 0.5,
        `${lang}: "${LABELS[lang].office}" comes before "${
          LABELS[lang].logout
        }" without overlapping`,
      );
      expect(
        m.logout.right <= W && m.logout.right >= W - 40,
        `${lang}: the actions row is end-aligned and on screen (Sign out right=${
          r(m.logout.right)
        })`,
      );
      expect.eq(
        m.logout.lines,
        1,
        `${lang}: "${LABELS[lang].logout}" is one line`,
      );
      expect.eq(
        m.office.lines,
        1,
        `${lang}: "${LABELS[lang].office}" is one line`,
      );
    }));
}
