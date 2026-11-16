/**
 * REQ-874 (demo-loop cycle dm5, issue p9) — the customer-ended notice on /admin covers no text.
 *
 * The demo saw "Demo mode · Maria Lopez ended the demo ×" sit bottom-right on /admin at
 * 1280×800, over the footer's address line ("45…" cut off; fleet-r38fa8936-0 stdout:94-96):
 * `placePill` took a spot with no control under it (text allowed, REQ-781) before a clear row.
 *
 * Hans (a super admin) opens a demo for Ana from /admin; Ana's app joins; Ana ends it (End, Yes).
 * Hans lands on /admin, which says "Ana Torres ended the demo": no text of the page (any visible
 * text node outside the demo's chrome) lies under the notice's box.
 */
import { story, type StoryTools } from "#shots";
import { pillUp } from "../_shared/demo-pill.ts";

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

/** the page's visible text under the notice: every text node outside the demo's chrome whose
 *  rendered box overlaps the notice's box */
const textUnderNotice = () => {
  const notice = document.querySelector<HTMLElement>("[data-cy='demo-ended']");
  if (!notice) return { notice: null, under: [] as string[] };
  const n = notice.getBoundingClientRect();
  const under: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = (t.textContent ?? "").trim();
    if (!text) continue;
    const el = t.parentElement;
    if (!el || notice.contains(el)) continue;
    if (el.closest("[data-demo-overlay],[data-cy^='demo-']")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    for (const b of range.getClientRects()) {
      if (b.width === 0 || b.height === 0) continue;
      if (
        b.left < n.right && n.left < b.right && b.top < n.bottom &&
        n.top < b.bottom
      ) {
        under.push(
          `'${text.slice(0, 40)}' @${Math.round(b.left)},${Math.round(b.top)} ${
            Math.round(b.width)
          }x${Math.round(b.height)}`,
        );
        break;
      }
    }
  }
  return {
    notice: [n.left, n.top, n.width, n.height].map(Math.round),
    under,
  };
};

Deno.test("REQ-874 (demo-loop cycle dm5, p9): on /admin at 1280×800 the customer-ended notice covers no text of the page (not the footer's address)", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setName(http, user.auth, "Ana Torres");
    const admin = await verify(http, adminPhone);
    await setName(http, admin.auth, "Hans");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    expect.eq(boot.status, 200, "Hans is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
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
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*(Live|Connected)\s*$/,
      }).waitFor({ timeout: 20_000 });
      await pillUp(userPage, { live: true });

      // Ana ends it
      await userPage.locator("[data-cy='demo-end']").click();
      await userPage.locator("[data-cy='demo-end-confirm']").click();

      // Hans lands on /admin, told who ended it
      await page.waitForURL((u) => u.pathname === "/admin", {
        timeout: 20_000,
      });
      await page.locator("[data-cy='demo-ended']").waitFor({ timeout: 15_000 });
      expect(
        (await page.locator("[data-cy='demo-ended']").innerText()).includes(
          "Ana Torres ended the demo",
        ),
        "/admin says the customer ended it, by name",
      );
      // past the notice's placement and glide
      await page.waitForTimeout(1_500);
      const r = await page.evaluate(textUnderNotice);
      await page.screenshot({ path: `${folder}/admin-ended-notice.png` });
      expect(r.notice !== null, "the notice is on /admin");
      expect(
        r.under.length === 0,
        `the notice ${
          JSON.stringify(r.notice)
        } covers no text of /admin — over ${JSON.stringify(r.under)}`,
      );
    } finally {
      await userCtx.close();
    }
  }));
