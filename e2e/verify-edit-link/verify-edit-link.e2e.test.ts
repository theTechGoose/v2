/**
 * REQ-351 — Raphael, 2026-11-11: "fix every issue the demo found, loop until there are none."
 * Demo cycle 1, issue p15-12: on /verify, "Wrong number? Edit" sent a visitor who typed the number
 * on /login to "/" — the marketing page — instead of back to the phone form they came from.
 *
 * Each sign-in form hands off to /verify with ?from=<origin>; Edit returns to that form:
 * /login → /login, "/" → "/#contact", /landing → "/landing#trial"; no origin → /login.
 */
import { story, type StoryTools } from "#shots";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };

async function editHref(page: StoryTools["page"]): Promise<string> {
  const link = page.locator(".meta a").first();
  await link.waitFor({ state: "visible", timeout: 15_000 });
  return (await link.getAttribute("href")) ?? "";
}

Deno.test('REQ-351: /verify\'s "Edit" goes back to the form the number was typed on — /login, "/" or /landing — never the marketing page by default', (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);

    // /login → /verify → Edit → /login
    await page.goto("/login");
    await page.locator("input[type='tel']").fill(`512${digits()}`);
    await page.locator("button[type='submit']").click();
    await page.waitForURL((u: URL) => u.pathname === "/verify");
    expect.eq(await editHref(page), "/login", "/login → /verify: Edit");
    await page.locator(".meta a").first().click();
    await page.waitForURL((u: URL) => u.pathname === "/login");
    expect(
      (await page.locator("input[type='tel']").count()) > 0,
      "Edit lands on the /login phone form",
    );

    // "/" (the static script) → /verify → Edit → /#contact
    await page.goto("/");
    await page.locator("#f-phone").fill(`512${digits()}`);
    await page.locator("#contact-form").evaluate((f: HTMLFormElement) =>
      f.requestSubmit()
    );
    await page.waitForURL((u: URL) => u.pathname === "/verify", {
      timeout: 60_000,
    });
    expect.eq(await editHref(page), "/#contact", '"/" → /verify: Edit');

    // /landing → /verify → Edit → /landing#trial (P-39, unchanged)
    await page.goto("/landing?lang=en");
    await page.locator("#trial-phone").fill(`512${digits()}`);
    await page.locator("#trial-phone").evaluate((el: HTMLInputElement) =>
      el.form!.requestSubmit()
    );
    await page.waitForURL((u: URL) => u.pathname === "/verify", {
      timeout: 60_000,
    });
    expect.eq(await editHref(page), "/landing#trial", "/landing → /verify: Edit");

    // no origin (an old link, a bookmark) → /login, not "/"
    await page.goto(
      `/verify?phone=${encodeURIComponent(`+1512${digits()}`)}&lang=en`,
    );
    expect.eq(await editHref(page), "/login", "no from=: Edit");
  }));
