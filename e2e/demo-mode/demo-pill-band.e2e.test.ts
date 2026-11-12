/**
 * REQ-440 — demo-loop cycle 3, issue m2: the customer's demo pill covered page content on pages
 * whose document scrolls — pairs 1, 2, 3, 5 and 9 saw it over "01 QUICK SUMMARY" on /q.
 *
 * A super admin opens a demo on a contractor; the contractor opens their own quote's public page
 * (/q/<id>) at 1280×720 and then on a 390×844 phone. On each: the pill sits on the band the page
 * leaves for it (the overlay paints it, window-wide, opaque, in the page's background) — so at no
 * scroll position is any of the page's text visible under the pill — and the "01 Quick summary"
 * heading, once scrolled to (aligned to the window's foot, the worst case), ends above the band
 * and does not intersect the pill.
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
 * Evaluated in the customer's page: the pill, the band, and what is on top over the pill once the
 * pill itself is set aside — the band (good) or a piece of the page (the bug). `heading`: the
 * "Quick Summary" section header's row.
 */
const probe = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const r = pill.getBoundingClientRect();
  const band = document.querySelector<HTMLElement>("[data-cy='demo-band']");
  const b = band?.getBoundingClientRect() ?? null;
  const visibleUnder: string[] = [];
  // the band never takes a click (pointer-events:none), and hit testing skips such boxes: let it
  // be hit for the measure, so the topmost box at a point is what is PAINTED there
  const was = band?.style.pointerEvents ?? "";
  if (band) band.style.pointerEvents = "auto";
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 2; j++) {
      const x = r.left + 2 + ((r.width - 4) * i) / 8;
      const y = r.top + 2 + ((r.height - 4) * j) / 2;
      const top = document.elementsFromPoint(x, y)
        .find((n) => !pill.contains(n));
      if (!top || top === band) continue;
      if (top === document.body || top === document.documentElement) continue;
      const text = (top.textContent ?? "").trim().slice(0, 24);
      if (text) visibleUnder.push(`${top.tagName.toLowerCase()} "${text}"`);
    }
  }
  if (band) band.style.pointerEvents = was;
  const title = Array.from(document.querySelectorAll<HTMLElement>("div"))
    .find((d) =>
      d.children.length === 0 &&
      /^quick summary$/i.test((d.textContent ?? "").trim())
    );
  const h = title?.parentElement?.getBoundingClientRect() ?? null;
  return {
    pill: {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
    },
    band: b
      ? {
        left: Math.round(b.left),
        top: Math.round(b.top),
        right: Math.round(b.right),
        bottom: Math.round(b.bottom),
        bg: getComputedStyle(band!).backgroundColor,
      }
      : null,
    heading: h
      ? {
        left: Math.round(h.left),
        top: Math.round(h.top),
        right: Math.round(h.right),
        bottom: Math.round(h.bottom),
      }
      : null,
    visibleUnder: [...new Set(visibleUnder)],
    vw: innerWidth,
    vh: innerHeight,
    scrollY: Math.round(scrollY),
    scrollPad: getComputedStyle(document.documentElement).scrollPaddingBottom,
  };
};
type Probe = NonNullable<ReturnType<typeof probe>>;

const opaque = (c: string) =>
  c !== "transparent" && !/rgba\([^)]*,\s*0(\.\d+)?\s*\)$/.test(c);
const meets = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

Deno.test("REQ-440 (demo-loop cycle 3, m2): on /q at 1280 px and 390 px the customer's pill sits on a real band — no text of the page shows under it, and the '01 Quick summary' heading, once scrolled to, ends above the band and never meets the pill", (t) =>
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
    const customer = await post(http, user.auth, "/api/customers", {
      name: "Hans Hansen",
      email: "hans@blackhole.postmarkapp.com",
      address: "725 Frederick Rd, Rockingham, VA",
    });
    const quote = await post(http, user.auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Deck rebuild — Hans Hansen",
      jobName: "Deck rebuild",
      description:
        "Tear out and rebuild the back deck: footings, framing, decking, rails and stairs.",
      lineItems: [
        { description: "Demolition", quantity: 1, unit: "job", price: 20000 },
        { description: "Framing", quantity: 1, unit: "job", price: 40000 },
        { description: "Decking", quantity: 1, unit: "job", price: 30000 },
      ],
      estimatedTotal: 90000,
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
      viewport: { width: 1280, height: 720 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/dashboard`);

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

      const connected = async () =>
        await userPage.locator("[data-cy='demo-status']").filter({
          hasText: /^\s*(Connected|Conectado)\s*$/,
        }).waitFor({ timeout: 20_000 });

      /** the probe once the pill and the band have held still (the band follows the pill) */
      const settled = async (): Promise<Probe> => {
        let last = await userPage.evaluate(probe);
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 300));
          const now = await userPage.evaluate(probe);
          if (
            now && last && now.heading && JSON.stringify(now.pill) ===
              JSON.stringify(last.pill) &&
            JSON.stringify(now.band) === JSON.stringify(last.band) &&
            JSON.stringify(now.heading) === JSON.stringify(last.heading)
          ) return now;
          last = now;
        }
        throw new Error(`the pill never held still: ${JSON.stringify(last)}`);
      };

      const check = async (where: string) => {
        await userPage.goto(`${baseUrl}/q/${quote.id}`);
        await connected();
        await userPage.getByText("Quick Summary", { exact: true }).waitFor({
          timeout: 15_000,
        });

        // as the page opens: the pill is on the band, nothing of the page shows under it
        const opened = await settled();
        await userPage.screenshot({
          path: `${folder}/q-${where}-opened.png`,
        });
        expect.eq(
          opened.visibleUnder.join(" | "),
          "",
          `${where}: no text of the page shows under the pill as /q opens`,
        );
        expect(
          opened.band !== null && opened.band.left <= 0 &&
            opened.band.right >= opened.vw &&
            opened.band.bottom >= opened.vh &&
            opened.band.top <= opened.pill.top && opened.band.bg !== "" &&
            opaque(opened.band.bg),
          `${where}: the band runs the window's width under the pill, opaque — ${
            JSON.stringify({ band: opened.band, pill: opened.pill })
          }`,
        );

        // the heading, scrolled to the window's foot (the worst case): above the band, clear of the pill
        await userPage.evaluate(() => {
          const title = Array.from(
            document.querySelectorAll<HTMLElement>("div"),
          )
            .find((d) =>
              d.children.length === 0 &&
              /^quick summary$/i.test((d.textContent ?? "").trim())
            );
          title?.parentElement?.scrollIntoView({
            block: "end",
            behavior: "instant",
          });
        });
        const scrolled = await settled();
        await userPage.screenshot({
          path: `${folder}/q-${where}-scrolled-to.png`,
        });
        const h = scrolled.heading!;
        expect(
          !meets(h, scrolled.pill),
          `${where}: the '01 Quick summary' heading, scrolled to, does not meet the pill — ${
            JSON.stringify({
              heading: h,
              pill: scrolled.pill,
              scrollPad: scrolled.scrollPad,
            })
          }`,
        );
        expect(
          scrolled.band !== null && h.bottom <= scrolled.band.top + 1,
          `${where}: the heading, scrolled to, ends above the band — ${
            JSON.stringify({ heading: h, band: scrolled.band })
          }`,
        );
        expect.eq(
          scrolled.visibleUnder.join(" | "),
          "",
          `${where}: no text of the page shows under the pill once scrolled`,
        );
      };

      await connected();
      await check("desktop-1280");
      await userPage.setViewportSize({ width: 390, height: 844 });
      await check("phone-390");
    } finally {
      await userCtx.close();
    }
  }));
