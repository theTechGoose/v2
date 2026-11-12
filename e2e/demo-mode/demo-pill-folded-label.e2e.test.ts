/**
 * REQ-637 — demo-loop cycle 5, issue m5: the customer's demo pill shrank to a tiny green tab
 * (16x40, a dot, no words) on public pages and mid-scroll, and End was hidden behind a hover.
 *
 * A super admin opens a demo on a contractor with 24 customers on a 390x844 phone. Mid-scroll the
 * pill still yields (REQ-545), but folded it is a labelled mini-pill: "Demo" and an x, 80-110 px,
 * flush with the left edge. The stage's ghost of it says "Demo" too. The x is End: one tap brings
 * the whole pill out with "End for everyone?" already asked; Keep going puts it back. On the
 * contractor's public quote page (/q) the whole pill, End included, sits on its bottom strip from
 * the first load and mid-scroll — never folded.
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
    pill: { left: Math.round(p.left), width: Math.round(p.width) },
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

Deno.test('REQ-637 (demo-loop cycle 5, m5): the folded customer pill is a labelled mini-pill ("Demo" and an x that is End), the stage ghost says Demo, and on the public /q the whole pill with End sits on its strip, never folded', (t) =>
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
      const connected = () =>
        until("the customer's pill says Connected", async () => {
          const p = await userPage.evaluate(look);
          return p && p.status === "live"
            ? null
            : JSON.stringify(p) + " errs: " + errs.join(" || ").slice(0, 1500);
        }, 25_000);
      await connected();
      await userPage.getByText("Customer 12 Hansen").first().waitFor({
        timeout: 15_000,
      });

      // 1. mid-scroll on the phone the pill folds (REQ-545) — to a mini-pill that says what it is
      await userPage.evaluate(scrollTo, 0.5);
      let m: Awaited<ReturnType<typeof look>> = null;
      await until("mid-scroll, the pill folds", async () => {
        m = await userPage.evaluate(look);
        return m && m.folded ? null : JSON.stringify(m);
      }, 8_000);
      await userPage.screenshot({ path: `${folder}/phone-mini-pill.png` });
      const f = m!;
      expect(
        f.pill.left === 0 && f.pill.width >= 80 && f.pill.width <= 110,
        `the folded pill is a mini-pill (80-110 px) on the left edge, not a 16 px sliver — ${
          JSON.stringify(f)
        }`,
      );
      expect(
        f.tab !== null && /Demo/.test(f.tab.text),
        `the folded pill says "Demo" — ${JSON.stringify(f)}`,
      );
      expect(
        f.tabEnd !== null && f.tabEnd.label === "End demo",
        `the folded pill keeps End (an x named "End demo") — ${
          JSON.stringify(f)
        }`,
      );

      // 2. the stage's ghost of the folded pill says "Demo" too
      await page.locator(
        "[data-cy='demo-pill-ghost'][data-tucked] [data-cy='demo-pill-ghost-tab-label']",
      ).waitFor({ state: "attached", timeout: 10_000 });
      expect.eq(
        (await page.locator("[data-cy='demo-pill-ghost-tab-label']")
          .textContent())?.trim(),
        "Demo",
        "the stage's mini-pill ghost says Demo",
      );

      // 3. the x is End: one tap, and "End for everyone?" is asked on the whole pill
      await userPage.locator("[data-cy='demo-pill-tab-end']").click();
      await userPage.locator("[data-cy='demo-pill'] [data-cy='demo-end-ask']")
        .waitFor({ state: "visible", timeout: 5_000 });
      await userPage.screenshot({ path: `${folder}/phone-end-asked.png` });
      await userPage.locator("[data-cy='demo-end-cancel']").click();
      // Keep going: the question is gone, the demo goes on, and End is still in reach (the whole
      // pill's End, or — once the pointer is off it — the folded mini-pill's x again)
      await userPage.locator("[data-cy='demo-end-ask']").waitFor({
        state: "detached",
        timeout: 5_000,
      });
      await until(
        "after Keep going, the demo is live with End in reach",
        async () => {
          const k = await userPage.evaluate(look);
          return k && k.status === "live" &&
              (k.end !== null || k.tabEnd !== null)
            ? null
            : JSON.stringify(k);
        },
        5_000,
      );

      // 4. the public quote page in the owner's browser: the whole pill with End, never folded
      await userPage.setViewportSize({ width: 1280, height: 720 });
      await userPage.goto(`${baseUrl}/q/${quote.id}`);
      await connected();
      await userPage.getByText("Quick Summary", { exact: true }).waitFor({
        timeout: 15_000,
      });
      for (const frac of [0, 0.5]) {
        await userPage.evaluate(scrollTo, frac);
        await new Promise((r) => setTimeout(r, 1_000));
        let q: Awaited<ReturnType<typeof look>> = null;
        await until(
          `/q at ${frac}: the whole pill with End, on its strip`,
          async () => {
            q = await userPage.evaluate(look);
            return q && !q.folded && q.end !== null && q.bandH > 0
              ? null
              : JSON.stringify(q);
          },
          8_000,
        ).catch(async (e) => {
          await userPage.screenshot({ path: `${folder}/q-${frac}-RED.png` });
          throw e;
        });
        await userPage.screenshot({ path: `${folder}/q-${frac}.png` });
        expect(
          /Demo mode/.test(q!.pillText),
          `/q at ${frac}: the pill says what it is — ${JSON.stringify(q)}`,
        );
      }
    } finally {
      await userCtx.close();
    }
  }));
