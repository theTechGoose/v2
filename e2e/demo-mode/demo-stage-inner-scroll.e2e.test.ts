/**
 * REQ-641 — demo issue m11 (demo-loop cycle 5, run r37f88707, pair 7): "She scrolled the quote
 * preview down to 'DETALLES DEL TRABAJO'. My stage still showed DE / PARA at the top of the card.
 * It caught up only after her next scroll." In two browsers: the admin on the stage, the customer
 * on their quote's public page, whose quote card (`.ctr`, the same card the assistant previews)
 * is made a scroller of its own — an INNER scroller, not the window.
 *
 * The customer scrolls that card in one burst (wheel ticks back to back, the browser's smooth
 * wheel scrolling), several times, down and back up; each time, within 300 ms of the customer's
 * scroll coming to rest, the stage frame's copy of the card has the same scrollTop. Never "caught
 * up only on the next scroll".
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

async function until(
  what: string,
  cond: () => boolean | Promise<boolean>,
  timeout = 15_000,
) {
  const t0 = Date.now();
  let last: unknown = null;
  while (Date.now() - t0 < timeout) {
    try {
      if (await cond()) return;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timed out: ${what}${last ? ` (last error: ${last})` : ""}`);
}

type Page = StoryTools["page"];
const FRAME = "[data-cy='demo-frame']";
const VIEW = { width: 420, height: 800 };
const PROBE = "[data-scroll-probe]";
/** REQ-641 — the stage has the customer's resting scroll this soon after it came to rest */
const CATCH_UP_MS = 300;

/** the probe's scrollTop in the stage's frame (-1: not there) */
const stageTop = (page: Page) =>
  page.evaluate(
    `(() => { const f = document.querySelector(${
      JSON.stringify(FRAME)
    }); const d = f && f.contentDocument; const e = d && d.querySelector(${
      JSON.stringify(PROBE)
    }); return e ? e.scrollTop : -1; })()`,
  ) as Promise<number>;

const customerTop = (page: Page) =>
  page.evaluate(
    `(() => { const e = document.querySelector(${
      JSON.stringify(PROBE)
    }); return e ? e.scrollTop : -1; })()`,
  ) as Promise<number>;

Deno.test("REQ-641 (cycle 5, demo m11): the customer scrolls the quote card's inner scroller in one burst — the stage frame's copy has the same scrollTop within 300 ms of the burst coming to rest, every time", (t) =>
  story(t, async (tools) => {
    const { page, expect, http, baseUrl } = tools;
    await page.setViewportSize({ width: 1280, height: 860 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Priya Nair" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Priya Nair",
      businessName: "Nair Kitchen & Bath",
    });
    const customer = await post(http, user.auth, "/api/customers", {
      name: "Hendersons",
      email: "hendersons@blackhole.postmarkapp.com",
      address: "3405 Shoal Creek Blvd, Austin TX 78705",
    });
    const quote = await post(http, user.auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Master bath and kitchen — Hendersons",
      jobName: "Master bath and kitchen",
      description:
        "Gut the master bath, add a double vanity with a quartz top, install a kitchen backsplash and finish before Thanksgiving.",
      lineItems: [
        { description: "Demolition", quantity: 1, unit: "job", price: 20000 },
        { description: "Plumbing", quantity: 1, unit: "job", price: 40000 },
        { description: "Tile", quantity: 1, unit: "job", price: 30000 },
        { description: "Vanity", quantity: 1, unit: "job", price: 10000 },
        { description: "Backsplash", quantity: 1, unit: "job", price: 10000 },
      ],
      estimatedTotal: 110000,
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
      body: JSON.stringify({ language: "en", name: "Alex" }),
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
    const userCtx = await browser.newContext({ viewport: VIEW });
    try {
      await useCookie(userCtx, baseUrl, user.cookie);
      const userPage = await userCtx.newPage();

      // the admin opens the demo and lands on the stage
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
      await page.locator("[data-cy='demo-connecting']").waitFor({
        timeout: 15_000,
      });

      const startPath = `/q/${quote.id}`;
      await userPage.goto(`${baseUrl}${startPath}`);
      await until(
        "the stage's mirror is on the customer's quote page",
        async () =>
          (await page.locator(FRAME).getAttribute("data-path")) === startPath,
        25_000,
      );

      // the quote card becomes a scroller of its own (as the assistant's preview card sits in
      // the chat's scroller): an attribute change, mirrored like any other
      await userPage.locator(".ctr").first().waitFor({ timeout: 15_000 });
      await userPage.evaluate((sel) => {
        const card = document.querySelector(".ctr") as HTMLElement;
        card.setAttribute(sel, "");
        card.style.maxHeight = "460px";
        card.style.overflowY = "auto";
        card.style.scrollBehavior = "smooth";
        card.scrollIntoView({ block: "start", behavior: "instant" });
      }, "data-scroll-probe");
      const room = await userPage.evaluate((sel) => {
        const e = document.querySelector(sel)!;
        return e.scrollHeight - e.clientHeight;
      }, PROBE);
      expect(room > 600, `the quote card scrolls inside itself (${room}px)`);
      await until(
        "the stage has the card as a scroller too",
        async () => {
          const r = await page.evaluate(
            `(() => { const d = document.querySelector(${
              JSON.stringify(FRAME)
            }).contentDocument; const e = d && d.querySelector(${
              JSON.stringify(PROBE)
            }); return e ? e.scrollHeight - e.clientHeight : 0; })()`,
          ) as number;
          return Math.abs(r - room) <= 2;
        },
        15_000,
      );

      // the customer's mouse over the card: the wheel scrolls it, not the page
      const box = await userPage.locator(PROBE).boundingBox();
      if (!box) throw new Error("no card box");
      await userPage.mouse.move(box.x + box.width / 2, box.y + 120);

      /** the customer's scrollTop once it stops moving (a smooth scroll runs on for a while) */
      const atRest = async (from?: number) => {
        // a smooth scroll starts on the next frame: wait for it to leave where it was
        for (let i = 0; from !== undefined && i < 10; i++) {
          if ((await customerTop(userPage)) !== from) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        let last = await customerTop(userPage);
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 50));
          const now = await customerTop(userPage);
          if (now === last) return now;
          last = now;
        }
        return last;
      };

      const bursts = [
        { what: "a short burst down", ticks: 3, dy: 120 },
        { what: "a long burst down", ticks: 8, dy: 100 },
        { what: "a burst back up", ticks: 4, dy: -110 },
        { what: "a flick down to the bottom", ticks: 12, dy: 160 },
        { what: "one tick up", ticks: 1, dy: -90 },
        { what: "a flick to the top", ticks: 12, dy: -200 },
      ];
      // and the ways a script or a person's tools scroll it: an assignment, scrollIntoView of a
      // heading inside the card (smooth: the card's own scroll-behavior), and a scroll while the
      // card's text is being replaced (the Español preview's "Translating the details…")
      type Burst = { what: string; run: () => Promise<unknown> };
      const wheel = (ticks: number, dy: number) => async () => {
        for (let k = 0; k < ticks; k++) await userPage.mouse.wheel(0, dy);
      };
      const inCard = (fn: string) => () =>
        userPage.evaluate(
          `(() => { const card = document.querySelector(${
            JSON.stringify(PROBE)
          }); (${fn})(card); })()`,
        );
      const all: Burst[] = [
        ...bursts.map((b) => ({ what: b.what, run: wheel(b.ticks, b.dy) })),
        {
          what: "scrollTop set by script",
          run: inCard("(c) => { c.scrollTop = 333; }"),
        },
        {
          what: "scrollIntoView of the card's terms (smooth)",
          run: inCard(
            "(c) => { c.querySelector(\"[data-cy='terms-details']\").scrollIntoView({ block: 'start' }); }",
          ),
        },
        {
          what: "back to the top by script",
          run: inCard(
            "(c) => { c.scrollTo({ top: 0, behavior: 'instant' }); }",
          ),
        },
        {
          what: "a scroll while the card's text is replaced",
          run: inCard(
            "(c) => { const ps = Array.from(c.querySelectorAll('li, p, td')); c.scrollTop = 520; ps.forEach((p, k) => { setTimeout(() => { p.textContent = (p.textContent || '') + ' (traducido)'; }, 10 * k); }); }",
          ),
        },
        { what: "a burst down after the text changed", run: wheel(5, 140) },
        // a page that runs no rendering steps (hidden, occluded, throttled) changes its scroll and
        // fires no scroll event: here the events are kept from reaching the page's listeners
        {
          what: "a burst whose scroll events never reach the page",
          run: async () => {
            await userPage.evaluate(() => {
              const w = globalThis as unknown as {
                __mute?: (e: Event) => void;
              };
              w.__mute = (e: Event) => e.stopImmediatePropagation();
              globalThis.addEventListener("scroll", w.__mute, true);
            });
            await wheel(6, -120)();
          },
        },
        {
          what: "a script scroll whose event never reaches the page",
          run: inCard(
            "(c) => { c.scrollTo({ top: 640, behavior: 'instant' }); }",
          ),
        },
      ];
      const misses: string[] = [];
      let before = await atRest();
      for (const b of all) {
        await b.run();
        const want = await atRest(before);
        expect(
          want !== before,
          `${b.what}: the customer's card scrolled (${before} → ${want})`,
        );
        const restedAt = Date.now();
        let got = await stageTop(page);
        while (
          Math.abs(got - want) > 1 && Date.now() - restedAt < CATCH_UP_MS
        ) {
          await new Promise((r) => setTimeout(r, 20));
          got = await stageTop(page);
        }
        if (Math.abs(got - want) > 1) {
          // how long it really takes, if it ever does without another scroll
          let late = "never within 3 s";
          while (Date.now() - restedAt < 3_000) {
            if (Math.abs((await stageTop(page)) - want) <= 1) {
              late = `${Date.now() - restedAt} ms`;
              break;
            }
            await new Promise((r) => setTimeout(r, 50));
          }
          misses.push(
            `${b.what}: customer at ${want}, stage at ${got} after ${CATCH_UP_MS} ms (caught up: ${late})`,
          );
        }
        before = want;
      }
      await userPage.evaluate(() => {
        const w = globalThis as unknown as { __mute?: (e: Event) => void };
        if (w.__mute) globalThis.removeEventListener("scroll", w.__mute, true);
      });
      expect.eq(
        misses.join("\n"),
        "",
        "the stage's card is where the customer's came to rest, within 300 ms, after every burst",
      );
    } finally {
      await userCtx.close();
    }
  }));
