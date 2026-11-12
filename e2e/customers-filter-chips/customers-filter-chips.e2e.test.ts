/**
 * REQ-357 — demo-loop cycle 1, issue p5: "/customers filter chips overflow".
 * In Spanish, at desktop widths (1280, 1100, 1024), a tablet (900) and a phone (390), every one of the
 * seven filter chips on /customers is fully on screen: none is clipped by the chip
 * row, the toolbar or the window, and the chip row is not a hidden scroller.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signInSpanish(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
    body: JSON.stringify({ language: "es", name: "Chips Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "es",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

type Fit = {
  chips: number;
  clipped: string[];
  rowScrolls: boolean;
  pageScrolls: boolean;
};

/** every chip's box against the chip row, the toolbar and the window */
function measure(page: StoryTools["page"]): Promise<Fit> {
  return page.evaluate(() => {
    const row = document.querySelector(".ctoolbar2__filters") as HTMLElement;
    const bar = document.querySelector(".ctoolbar2") as HTMLElement;
    const r = row.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const clipped: string[] = [];
    const chips = [...row.querySelectorAll<HTMLElement>(".ctoolbar2__filter")];
    for (const c of chips) {
      const k = c.getBoundingClientRect();
      const inside = (o: DOMRect) =>
        k.left >= o.left - 0.5 && k.right <= o.right + 0.5 &&
        k.top >= o.top - 0.5 && k.bottom <= o.bottom + 0.5;
      if (!inside(r) || !inside(b) || k.left < 0 || k.right > vw + 0.5) {
        clipped.push(
          `${c.innerText.replace(/\s+/g, " ").trim()} [${Math.round(k.left)}–${
            Math.round(k.right)
          } of row ${Math.round(r.left)}–${Math.round(r.right)}, window ${vw}]`,
        );
      }
    }
    return {
      chips: chips.length,
      clipped,
      rowScrolls: row.scrollWidth > row.clientWidth + 1,
      pageScrolls: document.documentElement.scrollWidth > vw + 1,
    };
  });
}

for (const width of [1280, 1100, 1024, 900, 390]) {
  Deno.test(`REQ-357: /customers in Spanish at ${width}px — all seven filter chips are fully on screen, none clipped or scrolled away`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signInSpanish(http, page, baseUrl);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/customers");
      await page.locator(".ctoolbar2__filter").first().waitFor();
      await expect.see("Todos");
      const fit = await measure(page);
      expect(fit.chips === 7, `seven chips (${fit.chips})`);
      expect(
        fit.clipped.length === 0,
        `no chip is clipped — clipped: ${fit.clipped.join(" · ")}`,
      );
      expect(
        !fit.rowScrolls,
        "the chip row is not a hidden horizontal scroller",
      );
      expect(!fit.pageScrolls, "the page does not scroll sideways");
    }));
}
