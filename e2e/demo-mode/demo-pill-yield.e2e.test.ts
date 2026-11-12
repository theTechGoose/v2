/**
 * REQ-545 — demo-loop cycle 4, issue m2: the customer's demo pill covered page content — tiles,
 * fields, confirm buttons, the pointer (pairs 2, 7, 8). REQ-379's single home in a reserved band
 * only freed the END of a document that scrolls: mid-scroll, whatever passed the window's foot was
 * under REQ-440's opaque band and the pill. And the public /q, /i and /co pages in the owner's
 * browser got the full pill and band too.
 *
 * A super admin opens a demo on a contractor who has 24 customers and sits on /customers on a
 * 390×844 phone. Scrolled to the middle, rows pass the window's foot: the pill tucks into a small
 * tab on the left edge, the band is not painted, and no point of the bottom strip right of the tab
 * has the demo's chrome over a piece of the page. The stage draws the tab (its ghost is tucked).
 * A hover on the tab shows the whole pill with End; leaving it tucks it again. On the contractor's
 * public quote page (/q) at 1280×720 the pill is a tab from the start and at mid-scroll, no band.
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

/** wait for a condition, polling; throws with `what` (and the last detail) when it never comes */
async function until(
  what: string,
  cond: () => Promise<string | null>,
  timeout = 10_000,
) {
  const t0 = Date.now();
  let last: string | null = "never asked";
  while (Date.now() - t0 < timeout) {
    try {
      last = await cond();
      if (last === null) return;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

/**
 * Evaluated in the customer's page: the pill's state, and every point of the window's bottom
 * strip (right of the tab) where the demo's chrome is painted over a piece of the page — the bug.
 */
const probe = (tabW: number) => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const band = document.querySelector<HTMLElement>("[data-cy='demo-band']");
  const tab = document.querySelector<HTMLElement>("[data-cy='demo-pill-tab']");
  const shown = (el: HTMLElement | null) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 &&
      getComputedStyle(el).visibility !== "hidden";
  };
  // the band never takes a click and hit testing skips it: let it be hit for the measure
  const was = band?.style.pointerEvents ?? "";
  if (band) band.style.pointerEvents = "auto";
  const pillWas = pill.style.pointerEvents;
  if (shown(pill)) pill.style.pointerEvents = "auto";
  const covered: string[] = [];
  const strip = 72;
  for (let x = tabW + 4; x < innerWidth - 2; x += 12) {
    for (let y = innerHeight - strip; y < innerHeight - 1; y += 8) {
      const stack = document.elementsFromPoint(x, y);
      const top = stack[0];
      if (!top || !top.closest("[data-demo-overlay]")) continue;
      const under = stack.find((n) => !n.closest("[data-demo-overlay]"));
      if (
        !under || under === document.body || under === document.documentElement
      ) continue;
      const text = (under.textContent ?? "").trim().replace(/\s+/g, " ").slice(
        0,
        30,
      );
      if (!text) continue;
      covered.push(`${under.tagName.toLowerCase()} "${text}"`);
    }
  }
  if (band) band.style.pointerEvents = was;
  pill.style.pointerEvents = pillWas;
  const t = tab?.getBoundingClientRect() ?? null;
  return {
    // the whole pill: its status shows (folded, the pill is only its tab)
    pillShown: shown(
      pill.querySelector<HTMLElement>("[data-cy='demo-status']"),
    ),
    folded: pill.hasAttribute("data-tucked"),
    tabShown: shown(tab),
    tab: t
      ? {
        left: Math.round(t.left),
        width: Math.round(t.width),
        height: Math.round(t.height),
        bottom: Math.round(t.bottom),
      }
      : null,
    bandH: band ? Math.round(band.getBoundingClientRect().height) : -1,
    // REQ-545 — the link's state, on the pill even while it is folded
    status: pill.dataset.status ?? "",
    covered: [...new Set(covered)],
    vh: innerHeight,
  };
};

/** scroll the page's main scroller (the document or the tallest overflowing box) to a fraction */
const scrollTo = (frac: number) => {
  const doc = document.scrollingElement as HTMLElement | null;
  let best: HTMLElement | null = doc && doc.scrollHeight > doc.clientHeight + 40
    ? doc
    : null;
  if (!best) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const oy = getComputedStyle(el).overflowY;
      if (!/(auto|scroll)/.test(oy)) continue;
      if (el.scrollHeight <= el.clientHeight + 40) continue;
      if (
        !best ||
        el.clientHeight * el.clientWidth > best.clientHeight * best.clientWidth
      ) best = el;
    }
  }
  if (!best) return null;
  best.scrollTop = Math.round((best.scrollHeight - best.clientHeight) * frac);
  return {
    top: best.scrollTop,
    height: best.scrollHeight,
    client: best.clientHeight,
  };
};

Deno.test("REQ-545 (demo-loop cycle 4, m2): the customer's demo pill yields — mid-scroll on a phone it tucks into a small edge tab and nothing of the page is under the band or the pill, a hover shows the whole pill with End, the stage draws the tab; on the public /q in the owner's browser it stays a tab", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Ana Torres" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Ana Torres",
      businessName: "Torres Plumbing",
    });
    // a long list, so the phone's page scrolls with rows passing the window's foot
    let first: { id: string } | null = null;
    for (let i = 0; i < 24; i++) {
      const c = await post(http, user.auth, "/api/customers", {
        name: `Customer ${String(i + 1).padStart(2, "0")} Hansen`,
        email: `c${i}-${digits()}@blackhole.postmarkapp.com`,
        address: `${100 + i} Frederick Rd, Rockingham, VA`,
      });
      first ??= c;
    }
    const quote = await post(http, user.auth, "/api/quotes", {
      customerId: first!.id,
      summary: "Deck rebuild — Hansen",
      jobName: "Deck rebuild",
      description:
        "Tear out and rebuild the back deck: footings, framing, decking, rails and stairs.",
      lineItems: [
        { description: "Demolition", quantity: 1, unit: "job", price: 20000 },
        { description: "Framing", quantity: 1, unit: "job", price: 40000 },
      ],
      estimatedTotal: 60000,
      status: "draft",
    });
    await (await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ status: "sent" }),
    })).body?.cancel();
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "en", name: "Alex from DocuMonster" }),
    })).body?.cancel();
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const userPage = await userCtx.newPage();
      const errs: string[] = [];
      userPage.on("pageerror", (e) => errs.push(String(e)));
      userPage.on("console", (m) => {
        if (m.type() === "error") errs.push(m.text());
      });
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/customers`);

      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto("/admin");
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      const TAB_W = 16;
      const connected = () =>
        until("the customer's pill says Connected", async () => {
          const p = await userPage.evaluate(probe, TAB_W);
          return p && p.status === "live"
            ? null
            : JSON.stringify(p) + " errs: " + errs.join(" || ").slice(0, 1500);
        }, 25_000);
      await connected();
      await userPage.getByText("Customer 12 Hansen").first().waitFor({
        timeout: 15_000,
      });

      // 1. mid-scroll on the phone: rows pass the window's foot — the pill tucks, nothing is hidden
      const scrolled = await userPage.evaluate(scrollTo, 0.5);
      expect(
        scrolled !== null,
        "the phone's /customers page scrolls (24 customers)",
      );
      let mid: Awaited<ReturnType<typeof probe>> = null;
      await until(
        "mid-scroll, nothing of the page is under the demo's chrome",
        async () => {
          mid = await userPage.evaluate(probe, TAB_W);
          return mid && mid.covered.length === 0 && mid.tabShown
            ? null
            : JSON.stringify(mid);
        },
        8_000,
      ).catch(async (e) => {
        await userPage.screenshot({
          path: `${folder}/phone-mid-scroll-RED.png`,
        });
        throw e;
      });
      await userPage.screenshot({ path: `${folder}/phone-mid-scroll.png` });
      const m = mid!;
      expect(
        !m.pillShown,
        `mid-scroll the full pill is tucked away — ${JSON.stringify(m)}`,
      );
      expect.eq(m.bandH, 0, "mid-scroll the band is not painted over the rows");
      expect(
        m.tab !== null && m.tab.left === 0 && m.tab.width <= TAB_W &&
          m.tab.height <= 40 && m.tab.bottom <= m.vh,
        `the tab is small, on the left edge — ${JSON.stringify(m.tab)}`,
      );

      // 2. the stage draws the tab where the customer has it (both screens agree)
      await page.locator("[data-cy='demo-pill-ghost'][data-tucked]").waitFor({
        state: "attached",
        timeout: 10_000,
      });
      expect.eq(
        await page.locator("[data-cy='demo-band-ghost']").count(),
        0,
        "the stage draws no band while the customer's band is not painted",
      );

      // 3. a hover on the tab shows the whole pill, End included; leaving it tucks it again
      // a real pointer onto the tab (it unfolds under the pointer)
      const tabAt = await userPage.locator("[data-cy='demo-pill-tab']")
        .boundingBox();
      if (!tabAt) throw new Error("no tab to hover");
      await userPage.mouse.move(
        tabAt.x + tabAt.width / 2,
        tabAt.y + tabAt.height / 2,
        { steps: 4 },
      );
      await userPage.locator("[data-cy='demo-pill'] [data-cy='demo-end']")
        .waitFor({ state: "visible", timeout: 5_000 });
      await userPage.screenshot({ path: `${folder}/phone-tab-hover.png` });
      // the pointer moves along the whole pill (it stays), then off it: folded again
      await userPage.mouse.move(
        tabAt.x + tabAt.width / 2 + 30,
        tabAt.y + tabAt.height / 2,
        { steps: 4 },
      );
      await new Promise((r) => setTimeout(r, 600));
      expect(
        (await userPage.evaluate(probe, TAB_W))?.pillShown === true,
        "the pill stays whole while the pointer is on it",
      );
      await userPage.mouse.move(300, 300);
      await until("the pill tucks again once the pointer leaves", async () => {
        const p = await userPage.evaluate(probe, TAB_W);
        return p && !p.pillShown && p.tabShown ? null : JSON.stringify(p);
      }, 5_000);

      // 4. the public quote page in the owner's browser: the pill stays a tab, no band
      await userPage.setViewportSize({ width: 1280, height: 720 });
      await userPage.goto(`${baseUrl}/q/${quote.id}`);
      await connected();
      await userPage.getByText("Quick Summary", { exact: true }).waitFor({
        timeout: 15_000,
      });
      for (const frac of [0, 0.5]) {
        await userPage.evaluate(scrollTo, frac);
        let q: Awaited<ReturnType<typeof probe>> = null;
        await until(
          `/q at ${frac}: the pill is a tab, nothing under the chrome`,
          async () => {
            q = await userPage.evaluate(probe, TAB_W);
            return q && q.tabShown && !q.pillShown && q.bandH === 0 &&
                q.covered.length === 0
              ? null
              : JSON.stringify(q);
          },
          8_000,
        );
        await userPage.screenshot({ path: `${folder}/q-${frac}.png` });
      }
    } finally {
      await userCtx.close();
    }
  }));
