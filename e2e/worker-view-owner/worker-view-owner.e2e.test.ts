/**
 * REQ-602 — demo-loop cycle 4, issue M35: "Owner's Worker view is a dead end
 * (needs worker phone+PIN)". A new owner with no workers clicks "Worker view"
 * and lands on /field/workers (where workers are added), not a cell + PIN
 * sign-in they cannot pass. An owner who opens /worker anyway is told this is
 * the screen their workers sign into, with a link to /field/workers; a
 * worker's phone (no owner session) sees the plain sign-in card.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signInOwner(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ language: "en", name: "Office Owner" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
}

Deno.test("REQ-602 (M35): an owner with no workers — the sidebar's Worker view goes to /field/workers", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signInOwner(http, page, baseUrl);
    await page.goto("/field/tasks?lang=en");
    const link = page.locator("[data-cy='nav-worker-view']").first();
    await link.waitFor({ timeout: 15_000 });
    let href: string | null = null;
    for (let i = 0; i < 30; i++) {
      href = await link.getAttribute("href");
      if (href === "/field/workers") break;
      await page.waitForTimeout(500);
    }
    expect.eq(href, "/field/workers", "no workers → the workers page");
  }));

Deno.test("REQ-739 (cycle 5, p18-3f): no workers — the row says 'Add a worker' and its href never shows /worker", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signInOwner(http, page, baseUrl);
    const seen: string[] = [];
    await page.exposeFunction("__pmHref", (h: string | null) => {
      seen.push(h ?? "(none)");
    });
    await page.addInitScript(() => {
      const report = () => {
        const a = document.querySelector("[data-cy='nav-worker-view']");
        if (a) {
          (globalThis as unknown as { __pmHref: (h: string | null) => void })
            .__pmHref(a.getAttribute("href"));
        }
      };
      new MutationObserver(report).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["href"],
      });
    });
    await page.goto("/field/tasks?lang=en");
    const link = page.locator("[data-cy='nav-worker-view']").first();
    await link.waitFor({ state: "visible", timeout: 15_000 });
    expect.eq(
      await link.getAttribute("href"),
      "/field/workers",
      "workers page",
    );
    expect.eq(await link.getAttribute("title"), "Add a worker", "label");
    expect.eq(
      seen.includes("/worker"),
      false,
      `the href never pointed at /worker (saw ${seen.join(", ")})`,
    );
  }));

Deno.test("REQ-602 (M35): an owner on /worker is told whose screen it is and can go add workers", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signInOwner(http, page, baseUrl);
    await page.goto("/worker?lang=en");
    const note = page.locator("[data-cy='w-owner-note']");
    await note.waitFor({ timeout: 15_000 });
    await expect.see("This is the screen your workers sign into");
    await page.locator("[data-cy='w-owner-workers']").click();
    await page.waitForURL(/\/field\/workers/, { timeout: 15_000 });
    expect(
      new URL(page.url()).pathname === "/field/workers",
      `landed on ${page.url()}`,
    );
  }));

Deno.test("REQ-602 (M35): a worker's phone (no owner session) shows no owner note", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='w-owner-note']").count(),
      0,
      "no owner note without an owner session",
    );
  }));
