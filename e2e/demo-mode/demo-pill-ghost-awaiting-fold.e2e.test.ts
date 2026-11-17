/**
 * REQ-854 — demo-loop cycle dm3, issue p6 (REQ-636 AMENDMENT): the stage's ghost of the customer's
 * pill flashed the whole pill's words ("Modo demo | Alex te está guiando | Conectando… | Terminar
 * demo") in the folded tab's 96x32 box for ~51 ms on each load of the customer's page, while the
 * customer's own screen only ever showed the folded "Demo ×" (REQ-830).
 *
 * The customer (390x844 phone, /customers) scrolls until the pill folds to its mini-pill; the stage
 * shows the folded ghost. A sampler on the stage records the ghost every animation frame while the
 * customer reloads the page. No sample may carry the status line ("Connecting…"), and no sample may
 * draw the whole pill in a tab-sized box.
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

/** the customer's pill, as a person sees it */
const look = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const box = (sel: string) => {
    const el = pill.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    return {
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
      text: (el.textContent ?? "").trim(),
      label: el.getAttribute("aria-label") ?? "",
    };
  };
  const band = document.querySelector<HTMLElement>("[data-cy='demo-band']");
  const p = pill.getBoundingClientRect();
  return {
    folded: pill.hasAttribute("data-tucked"),
    status: pill.dataset.status ?? "",
    pill: {
      left: Math.round(p.left),
      right: Math.round(p.right),
      width: Math.round(p.width),
    },
    vw: innerWidth,
    pillText: (pill.textContent ?? "").replace(/\s+/g, " ").trim(),
    tab: box("[data-cy='demo-pill-tab']"),
    tabEnd: box("[data-cy='demo-pill-tab-end']"),
    end: box("[data-cy='demo-end']"),
    bandH: band ? Math.round(band.getBoundingClientRect().height) : -1,
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

/** the stage's ghost, sampled every animation frame into window.__ghost */
const sampleGhost = () => {
  // deno-lint-ignore no-explicit-any
  const w = window as any;
  w.__ghost = [];
  w.__ghostOn = true;
  const tick = () => {
    if (!w.__ghostOn) return;
    for (
      const g of Array.from(
        document.querySelectorAll<HTMLElement>("[data-cy='demo-pill-ghost']"),
      )
    ) {
      const r = g.getBoundingClientRect();
      w.__ghost.push({
        t: Math.round(performance.now()),
        tucked: g.hasAttribute("data-tucked"),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: Array.from(g.querySelectorAll<HTMLElement>("*"))
          .filter((e) => e.children.length === 0)
          .map((e) => (e.textContent ?? "").trim())
          .filter(Boolean)
          .join("|"),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
type Sample = {
  t: number;
  tucked: boolean;
  w: number;
  h: number;
  text: string;
};

Deno.test("REQ-854 (demo-loop cycle dm3, p6): a reload of the customer's page with the pill folded never flashes the whole pill's words (Connecting…) in the stage's ghost — sampled every animation frame", (t) =>
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
    // a long list, so the phone's page scrolls and the pill folds mid-scroll (REQ-545)
    for (let i = 0; i < 24; i++) {
      await post(http, user.auth, "/api/customers", {
        name: `Customer ${String(i + 1).padStart(2, "0")} Hansen`,
        email: `c${i}-${digits()}@blackhole.postmarkapp.com`,
        address: `${100 + i} Frederick Rd, Rockingham, VA`,
      });
    }
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
      await until("the customer's pill says Connected", async () => {
        const p = await userPage.evaluate(look);
        return p && p.status === "live" ? null : JSON.stringify(p);
      }, 25_000);
      await userPage.getByText("Customer 12 Hansen").first().waitFor({
        timeout: 15_000,
      });

      // 1. mid-scroll the customer's pill folds, and the stage's ghost is the folded tab
      await userPage.evaluate(scrollTo, 0.5);
      await until("mid-scroll, the pill folds", async () => {
        const m = await userPage.evaluate(look);
        return m && m.folded ? null : JSON.stringify(m);
      }, 8_000);
      await page.locator("[data-cy='demo-pill-ghost'][data-tucked]").waitFor({
        state: "attached",
        timeout: 10_000,
      });

      // 2. sample the stage's ghost every frame while the customer reloads the page — three
      // times: the guess is up only until the new page's first face (~50 ms), so one load can
      // slip between two frames
      await page.evaluate(sampleGhost);
      for (let n = 1; n <= 3; n++) {
        const before = await userPage.evaluate(() => performance.timeOrigin);
        await userPage.reload();
        expect(
          (await userPage.evaluate(() => performance.timeOrigin)) !== before,
          `reload ${n}: the customer's page really loaded again`,
        );
        await until(
          `reload ${n}: the customer's pill is live again`,
          async () => {
            const p = await userPage.evaluate(look);
            return p && p.status === "live" ? null : JSON.stringify(p);
          },
          25_000,
        );
        // the stage follows the new page and its pill speaks: give it a few seconds of frames
        await new Promise((r) => setTimeout(r, 3_000));
      }
      const samples: Sample[] = await page.evaluate(() => {
        // deno-lint-ignore no-explicit-any
        const w = window as any;
        w.__ghostOn = false;
        return w.__ghost;
      });
      await page.screenshot({ path: `${folder}/stage-after-reload.png` });
      expect(
        samples.length > 30,
        `the sampler ran (${samples.length} samples)`,
      );
      expect(
        samples.some((s) => s.tucked && /Demo/.test(s.text)),
        "the stage drew the folded tab (Demo ×) through the reloads",
      );
      const said = samples.filter((s) => /Connecting/.test(s.text));
      expect(
        said.length === 0,
        `the stage's ghost never says the status line on a reload of a folded page — ${
          JSON.stringify(said.slice(0, 5))
        }`,
      );
      const wholeInTab = samples.filter((s) =>
        !s.tucked && s.w <= 97 && s.h <= 33
      );
      expect(
        wholeInTab.length === 0,
        `the whole pill is never drawn in the tab's box — ${
          JSON.stringify(wholeInTab.slice(0, 5))
        }`,
      );
    } finally {
      await userCtx.close();
    }
  }));
