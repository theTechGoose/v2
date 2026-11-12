/**
 * REQ-548 (demo-loop cycle 4, issue p4-p3e) — End's question on the phone never shortens the
 * guide's name. Alexandra (a super admin) opens a demo for Ana from /admin; Ana is on a 390×844
 * phone, so her pill is compact and shows "● Alexandra  Connected  End". The demo agent saw
 * "A..  Connected  End for everyone? [Yes, end it] Keep going" once End was clicked: the
 * question squeezed the name. Now the name stays whole while End asks, and the question with
 * both answers fits inside the phone; Keep going puts End back.
 */
import { story, type StoryTools } from "#shots";

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

async function setName(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name }),
  })).body?.cancel();
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

/** the guide's name on the compact pill, and End's question, as laid out */
const probe = () => {
  const guide = document.querySelector<HTMLElement>("[data-cy='demo-guide']");
  const name = guide?.lastElementChild as HTMLElement | null;
  const ask = document.querySelector<HTMLElement>("[data-cy='demo-end-ask']");
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const box = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
    };
  };
  return {
    name: name?.textContent ?? null,
    nameCut: name ? name.scrollWidth > name.clientWidth + 0.5 : null,
    nameWidth: name ? Math.round(name.getBoundingClientRect().width) : null,
    guideCut: guide ? guide.scrollWidth > guide.clientWidth + 0.5 : null,
    pill: box(pill),
    ask: box(ask),
    yes: box(document.querySelector("[data-cy='demo-end-confirm']")),
    keep: box(document.querySelector("[data-cy='demo-end-cancel']")),
    vw: globalThis.innerWidth,
  };
};

Deno.test("REQ-548 (demo-loop cycle 4, p4-p3e): on a 390 px phone, End's question never shortens the guide's name on the compact pill — 'Alexandra' stays whole, the question and both answers fit inside the phone, and Keep going puts End back", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setName(http, user.auth, "Ana Torres");
    const admin = await verify(http, adminPhone);
    await setName(http, admin.auth, "Alexandra Whitfield");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    expect.eq(boot.status, 200, "Alexandra is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, admin.cookie);

      await page.goto(`${baseUrl}/admin`);
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      await userPage.reload();
      await userPage.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Connected\s*$/,
      }).waitFor({ timeout: 20_000 });
      await userPage.locator("[data-cy='demo-guide']").waitFor({
        timeout: 10_000,
      });

      const before = await userPage.evaluate(probe);
      await userPage.screenshot({ path: `${folder}/phone-resting.png` });
      expect(
        before.name === "Alexandra" && before.nameCut === false,
        `resting: the compact pill names the guide in full — ${
          JSON.stringify(before)
        }`,
      );

      // End asks: the name must stay whole
      await userPage.locator("[data-cy='demo-end']").click();
      await userPage.locator("[data-cy='demo-end-ask']").waitFor({
        timeout: 2_000,
      });
      const asking = await userPage.evaluate(probe);
      await userPage.screenshot({ path: `${folder}/phone-asking.png` });
      expect(
        asking.name === "Alexandra" && asking.nameCut === false &&
          asking.guideCut === false &&
          asking.nameWidth === before.nameWidth,
        `asking: the guide's name is not shortened (was ${before.nameWidth} px) — ${
          JSON.stringify(asking)
        }`,
      );
      const inside = (b: { left: number; right: number } | null) =>
        b !== null && b.left >= 0 && b.right <= asking.vw - 12;
      expect(
        inside(asking.ask) && inside(asking.yes) && inside(asking.keep),
        `asking: the question, Yes and Keep going are inside the phone — ${
          JSON.stringify(asking)
        }`,
      );

      // Keep going: End is back, the name still whole, the demo goes on
      await userPage.locator("[data-cy='demo-end-cancel']").click();
      await userPage.locator("[data-cy='demo-end']").waitFor({
        timeout: 2_000,
      });
      const after = await userPage.evaluate(probe);
      expect(
        after.name === "Alexandra" && after.nameCut === false,
        `after Keep going: the name is whole — ${JSON.stringify(after)}`,
      );
    } finally {
      await userCtx.close();
    }
  }));
