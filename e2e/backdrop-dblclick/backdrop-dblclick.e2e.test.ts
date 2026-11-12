/**
 * REQ-354 (demo issue M39, cycle 1) — "fix every issue the demo found":
 * a double-click on "New customer" showed nothing and sent no request. The
 * dialog's full-screen backdrop is painted over the button that opened it
 * and closed on any click, so the double-click's second click closed it.
 * Every backdrop now dismisses only on a deliberate single click (the
 * shared <Backdrop>, lib/backdrop-dismiss.ts). Here, in a real browser:
 * a double-click on the opener leaves the dialog open; a later, deliberate
 * click on the backdrop still closes it.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: body.recoveryToken }) });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const me = await http("/api/me", { method: "PUT", headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify({ language: "en", name: "Dblclick Story" }) });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [{ name, value, domain, path: "/" }, { name: "pm_lang", value: "en", domain, path: "/" }]));
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(page: StoryTools["page"], selector: string, done: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

async function waitFor(page: StoryTools["page"], what: string, ok: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    if (await ok()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`timed out: ${what}`);
}

/** a deliberate click on the backdrop's top-left corner, well after it opened */
async function clickBackdropCorner(page: StoryTools["page"]) {
  await page.waitForTimeout(600);
  await page.mouse.click(4, 4);
}

Deno.test("REQ-354 M39: a double-click on New customer leaves the dialog open; a deliberate backdrop click still closes it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/customers");
    const dialog = page.getByRole("dialog", { name: "New customer" });
    const open = async () => (await dialog.count()) > 0 && await dialog.isVisible();

    // hydrate: one click opens it; a deliberate backdrop click closes it
    await clickUntil(page, "button.ph2__cta", open);
    await clickBackdropCorner(page);
    await waitFor(page, "the New customer dialog closes on a deliberate backdrop click", async () => !(await open()));

    // the demo's gesture: a double-click on the opener
    await page.locator("button.ph2__cta").first().dblclick();
    await page.waitForTimeout(800);
    expect(await open(), "after a double-click on New customer the dialog is still open");
  }));

Deno.test("REQ-354 M39: a double-click on Payments → Record payment leaves its dialog open", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/payments");
    const modal = page.locator("[data-cy='payments-record-modal']");
    const open = async () => (await modal.count()) > 0;

    await clickUntil(page, "[data-cy='payments-record']", open);
    await clickBackdropCorner(page);
    await waitFor(page, "the record-payment dialog closes on a deliberate backdrop click", async () => !(await open()));

    await page.locator("[data-cy='payments-record']").first().dblclick();
    await page.waitForTimeout(800);
    expect(await open(), "after a double-click on Record payment the dialog is still open");
  }));
