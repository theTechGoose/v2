/**
 * REQ-820 — demo-loop cycle dm1, issues m6 + test-setup-m4: with the customer's pill folded to
 * its edge tab, a pointer that came to rest on the tab opened the whole pill, which folded again
 * after PILL_PEEK_MS (6 s) with the pointer still on it; the tab re-mounted under the pointer,
 * Chromium's hover update re-opened it, and each opening slid the whole pill in from the tab's
 * translate — half off-screen on the right edge — every ~6 s (the tester's rAF log:
 * 0:836 5111:1141 5212:877 5312:836 11124:1141 …). Playwright's hover on the tab kept failing
 * "element was detached" for the same reason (the tab swap itself is by design, REQ-545).
 *
 * A super admin opens a demo on a contractor with 24 customers; the customer sits on /customers
 * in a 1280×800 window, scrolled to the middle so rows pass the window's foot and the pill folds
 * to its tab. A real pointer moves onto the tab and rests there for 8 s: the pill shows whole the
 * whole time (never folded again), and no frame of it is past the window's right edge. Then the
 * pointer leaves: it folds.
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

const probe = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const tab = document.querySelector<HTMLElement>("[data-cy='demo-pill-tab']");
  const t = tab?.getBoundingClientRect() ?? null;
  return {
    status: pill.dataset.status ?? "",
    folded: pill.hasAttribute("data-tucked"),
    tab: t && t.width > 0 ? { x: t.x, y: t.y, w: t.width, h: t.height } : null,
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
  return best.scrollTop;
};

/** every animation frame from now: the pill's box and whether it is folded */
const startSampling = () => {
  const w = globalThis as unknown as {
    __pillLog: string[];
    __pillRun: boolean;
  };
  w.__pillLog = [];
  w.__pillRun = true;
  const t0 = performance.now();
  const tick = () => {
    if (!w.__pillRun) return;
    const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
    if (pill) {
      const r = pill.getBoundingClientRect();
      w.__pillLog.push(
        `${Math.round(performance.now() - t0)}:${Math.round(r.left)}-${
          Math.round(r.right)
        }${pill.hasAttribute("data-tucked") ? ":tab" : ""}`,
      );
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const stopSampling = () => {
  const w = globalThis as unknown as {
    __pillLog: string[];
    __pillRun: boolean;
  };
  w.__pillRun = false;
  return { log: w.__pillLog, vw: innerWidth };
};

Deno.test("REQ-820 (demo-loop cycle dm1, m6 + test-setup-m4): a pointer resting on the customer's pill after it unfolds from its edge tab keeps it whole — no refold after PILL_PEEK_MS, no slide past the window's edge — and leaving folds it", (t) =>
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
      viewport: { width: 1280, height: 800 },
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
        const p = await userPage.evaluate(probe);
        return p && p.status === "live" ? null : JSON.stringify(p);
      }, 25_000);
      await userPage.getByText("Customer 12 Hansen").first().waitFor({
        timeout: 15_000,
      });

      // mid-scroll: rows pass the window's foot, the pill folds to its edge tab
      expect(
        (await userPage.evaluate(scrollTo, 0.5)) !== null,
        "the /customers page scrolls (24 customers)",
      );
      let tab: { x: number; y: number; w: number; h: number } | null = null;
      await until("the pill folds to its tab mid-scroll", async () => {
        const p = await userPage.evaluate(probe);
        tab = p?.folded ? p.tab : null;
        return tab ? null : JSON.stringify(p);
      }, 8_000);
      const at = tab!;

      // a real pointer onto the tab, then it rests there
      await userPage.evaluate(startSampling);
      await userPage.mouse.move(at.x + at.w / 2, at.y + at.h / 2, {
        steps: 4,
      });
      await userPage.locator("[data-cy='demo-pill'] [data-cy='demo-end']")
        .waitFor({ state: "visible", timeout: 5_000 });
      await new Promise((r) => setTimeout(r, 8_000));
      const { log, vw } = await userPage.evaluate(stopSampling);
      await userPage.screenshot({ path: `${folder}/pointer-rested-8s.png` });
      // from the first whole frame on: never folded, never past the right edge (or the left)
      const first = log.findIndex((s) => !s.endsWith(":tab"));
      expect(
        first >= 0,
        `the pill opened whole — ${log.slice(0, 20).join(" ")}`,
      );
      const after = log.slice(first);
      const refolds = after.filter((s) => s.endsWith(":tab"));
      expect(
        refolds.length === 0,
        `the pill stays whole while the pointer rests on it (8 s > PILL_PEEK_MS) — folded at ${
          refolds.slice(0, 5).join(" ")
        }`,
      );
      const off = after.filter((s) => {
        const [, box] = s.split(":");
        const [l, r] = box.split("-").map(Number);
        return r > vw + 1 || l < -1;
      });
      expect(
        off.length === 0,
        `no frame of the whole pill is past the window's edge (vw ${vw}) — ${
          off.slice(0, 8).join(" ")
        }`,
      );

      // the pointer leaves: it folds again
      await userPage.mouse.move(640, 200, { steps: 4 });
      await until("the pill folds once the pointer leaves", async () => {
        const p = await userPage.evaluate(probe);
        return p?.folded ? null : JSON.stringify(p);
      }, 5_000);
    } finally {
      await userCtx.close();
    }
  }));
