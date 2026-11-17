/**
 * REQ-890 AMENDMENT 5 (demo-loop run 16, m1 + m2; by hand) — the customer's folded tab at 390 px:
 * a mouse resting on its "Demo" opens the peek. On /reports the right-docked tab's row is crowded
 * with words, so the peek opened a row ABOVE the mouse (its bottom 35 px over it) and the click
 * meant for "Demo" hit the page's card; on /dashboard the left-docked tab's peek opened under the
 * mouse and then, at the next placement, hopped to the top of the screen — held open there by the
 * pointer on the tab's box. A peek opens UNDER the pointer that opens it (a box of the tab's row
 * that covers it, words or not), and a peek the pointer is on keeps its box while the pointer
 * stays on it. The click there is the tab's (REQ-890 AMENDMENT 4): it shows the controls.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function verify(http: StoryTools["http"], phone: string) {
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
  if (!cookie) throw new Error("sign-in: no session cookie");
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}
// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

/** Maria (EN, onboarded) on `path` at 390×844 with the pill folded; Alex on /admin, the demo on */
async function setUp(
  // deno-lint-ignore no-explicit-any
  page: any,
  http: StoryTools["http"],
  baseUrl: string,
  path: string,
) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "en", name: "Maria Lopez" }),
  })).body?.cancel();
  await answerQuestions(http, user.auth, {
    name: "Maria Lopez",
    businessName: "Lopez Roofing",
  });
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Alex" }),
  })).body?.cancel();
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: adminPhone }),
  });
  await boot.body?.cancel();
  if (boot.status !== 200) throw new Error(`bootstrap: ${boot.status}`);
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const tab = await userCtx.newPage();
  await useCookie(userCtx, baseUrl, user.cookie);
  await tab.goto(`${baseUrl}${path}?lang=en`);
  await useCookie(page.context(), baseUrl, admin.cookie);
  await page.goto(`${baseUrl}/admin?lang=en`);
  await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await page.locator("[data-cy='adm-search']").click();
  await page.locator("[data-cy='adm-demo']").first().waitFor({
    timeout: 15_000,
  });
  await page.locator("[data-cy='adm-demo']").first().click();
  await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
  await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
  await tab.locator("[data-cy='demo-pill'][data-tucked]").waitFor({
    timeout: 30_000,
  });
  await tab.waitForTimeout(500);
  return { userCtx, tab };
}

const state = ([x, y]: [number, number]) => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const r = pill?.getBoundingClientRect();
  const e = document.elementFromPoint(x, y) as HTMLElement | null;
  const b = e?.closest("button");
  const det = document.querySelector<HTMLElement>("[data-cy='demo-details']");
  return {
    box: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null,
    tucked: pill?.hasAttribute("data-tucked") ?? null,
    peek: pill?.hasAttribute("data-peek") ?? null,
    under: b
      ? (b.getAttribute("data-cy") ?? b.textContent?.trim())
      : (e?.getAttribute("data-cy") ?? e?.tagName ?? null),
    inPill: !!(pill && e && pill.contains(e)),
    asking: !!document.querySelector("[data-cy='demo-end-ask']"),
    more: document.querySelector("[data-cy='demo-more']")?.getAttribute(
      "aria-expanded",
    ) ?? null,
    details: det ? getComputedStyle(det).display !== "none" : false,
  };
};

Deno.test("REQ-890 AMENDMENT 5 (demo-loop run 16, m2 + m1): on /reports at 390×844 the right-docked tab's row is crowded with words — the peek the resting mouse opens still covers the mouse, stays put for 2.5 s, and the click there shows the controls (never the page, never End's question)", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab } = await setUp(page, http, baseUrl, "/reports");
    try {
      const tb = (await tab.evaluate(state, [0, 0] as [number, number])).box!;
      // the tab's "Demo" label, 20 px in from its left edge
      const mx = tb[0] + 20, my = tb[1] + 16;
      await tab.mouse.move(mx, my + 100);
      await tab.mouse.move(mx, my);
      await tab.waitForTimeout(600);
      const hovered = await tab.evaluate(state, [mx, my] as [number, number]);
      await tab.screenshot({ path: `${folder}/peek-under-mouse-390.png` });
      expect(
        hovered.peek === true,
        `the resting mouse opened the peek (${JSON.stringify(hovered)})`,
      );
      expect(
        hovered.inPill,
        `m2: the peek is under the mouse at (${mx},${my}) (tab ${
          JSON.stringify(tb)
        }; ${JSON.stringify(hovered)})`,
      );
      expect(
        hovered.box![1] + hovered.box![3] >= tb[1] + tb[3] - 2,
        `the peek is on the tab's row (its foot ${
          hovered.box![1] + hovered.box![3]
        } vs the tab's ${tb[1] + tb[3]})`,
      );
      // m1 — the mouse rests: three placements (PILL_CHECK_MS 700) later it is still the same box
      const seen: unknown[] = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 2_500) {
        seen.push({
          at: Date.now() - t0,
          ...(await tab.evaluate(state, [mx, my] as [number, number])),
        });
        await tab.waitForTimeout(150);
      }
      await Deno.writeTextFile(
        `${folder}/peek-rest-samples.json`,
        JSON.stringify({ tb, mx, my, hovered, seen }, null, 1),
      );
      const moved = seen.filter((s) => {
        const x = s as { box: number[] | null; peek: boolean };
        return !x.peek || !x.box || x.box[0] !== hovered.box![0] ||
          x.box[1] !== hovered.box![1];
      });
      expect(
        moved.length === 0,
        `m1: a peek the mouse is on keeps its box ${
          JSON.stringify(hovered.box)
        }: ${JSON.stringify(moved.slice(0, 3))}`,
      );
      // the click aimed at "Demo": the tab's — the controls show, no question
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.waitForTimeout(500);
      const clicked = await tab.evaluate(state, [mx, my] as [number, number]);
      expect(
        !clicked.asking,
        `the click never asks to end the demo (${JSON.stringify(clicked)})`,
      );
      // a click on End where the tab was is the tab's (REQ-890 AMENDMENT 4): the controls show
      if (hovered.under === "demo-end") {
        expect(
          clicked.peek === true && (clicked.more === "true" || clicked.details),
          `the click was the tab's: the controls show (${
            JSON.stringify(clicked)
          })`,
        );
      }
    } finally {
      await userCtx.close();
    }
  }));
