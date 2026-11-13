/**
 * REQ-358 — demo issue m45 (cycle 1): on a 390 px phone the sidebar drawer had no close
 * button, painted over the ☰ that toggles it, and re-opened on the last folder browsed.
 * Now: the drawer's head has a 44 px ✕ inside the drawer; ✕, the backdrop and Escape all
 * close it; and it always re-opens at the page's own folder (the root on /customers).
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
  return { cookie, auth: { ...JSON_HEADERS, cookie } };
}

Deno.test("REQ-358: at 390 px the drawer has a 44 px ✕; ✕, backdrop and Escape close it; it re-opens at the page's folder, not the last one browsed", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const user = await verify(http, `+1512${digits()}`);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Ana Torres" }),
    })).body?.cancel();
    const [name, value] = user.cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]));
    await page.setViewportSize({ width: 390, height: 844 });

    const sb = page.locator("aside.sb");
    const menu = page.locator("[data-cy='mobile-menu']");
    const close = sb.locator("[data-cy='sb-close']");
    const isOpen = () => sb.evaluate((el) => el.classList.contains("sb--open"));
    const waitOpen = async (want: boolean, why: string) => {
      for (let i = 0; i < 50; i++) {
        if (await isOpen() === want) return;
        await page.waitForTimeout(100);
      }
      expect(false, `${why}: drawer ${want ? "open" : "closed"}`);
    };
    // the drawer slides (240 ms) — read geometry once it has settled
    const settle = () => page.waitForTimeout(400);
    const openDrawer = async () => {
      await menu.click();
      await waitOpen(true, "☰ opens the drawer");
      await settle();
    };
    const openBilling = async () => {
      await sb.locator("[data-cy='nav-folder-billing']").click();
      await sb.locator("[data-cy='nav-back']").waitFor({ timeout: 10_000 });
    };
    const expectRoot = async (why: string) => {
      expect(
        await sb.locator("[data-cy='nav-back']").count() === 0 &&
          await sb.locator("[data-cy='nav-folder-billing']").count() === 1,
        `${why}: the drawer re-opens at the root, not inside Billing`,
      );
    };

    await page.goto("/customers");
    await menu.waitFor({ timeout: 20_000 });
    await sb.locator("[data-cy='nav-folder-billing']").waitFor({
      state: "attached",
      timeout: 20_000,
    });
    await sb.locator(".nav-item__label", { hasText: "Customers" }).waitFor({
      state: "attached",
      timeout: 20_000,
    });

    // 1. the ✕: visible inside the open drawer, at least 44 × 44
    await openDrawer();
    await close.waitFor({ state: "visible", timeout: 10_000 });
    const box = await close.boundingBox();
    const drawer = await sb.boundingBox();
    expect(box !== null && drawer !== null, "✕ and drawer have boxes");
    expect(
      box!.width >= 44 && box!.height >= 44,
      `the ✕ is at least 44 px (${box!.width}×${box!.height})`,
    );
    expect(
      box!.x >= drawer!.x && box!.x + box!.width <= drawer!.x + drawer!.width,
      "the ✕ sits inside the drawer",
    );
    await page.screenshot({ path: `${folder}/drawer-open-390.png` });

    // 2. browse into Billing, close with ✕ → re-opens at the root
    await openBilling();
    await close.click();
    await waitOpen(false, "✕ closes the drawer");
    await openDrawer();
    await expectRoot("after ✕");

    // 3. the backdrop closes it, and the folder resets too
    await openBilling();
    await page.mouse.click(370, 400); // right of the 260 px drawer: the backdrop
    await waitOpen(false, "the backdrop closes the drawer");
    await openDrawer();
    await expectRoot("after the backdrop");

    // 4. Escape closes it
    await openBilling();
    await page.keyboard.press("Escape");
    await waitOpen(false, "Escape closes the drawer");
    await openDrawer();
    await expectRoot("after Escape");

    // 5. on a page inside Billing the drawer rests at Billing, wherever it was browsed to
    // REQ-773: Quotes moved to the root — Invoices is the page inside Billing now
    await page.goto("/invoices");
    await menu.waitFor({ timeout: 20_000 });
    await sb.locator("[data-cy='nav-back']").waitFor({
      state: "attached",
      timeout: 20_000,
    });
    await openDrawer();
    await sb.locator("[data-cy='nav-back']").click(); // up to the root
    await sb.locator("[data-cy='nav-folder-field']").click();
    await close.click();
    await waitOpen(false, "✕ closes the drawer on /invoices");
    await openDrawer();
    expect(
      await sb.locator("a[href='/invoices'].nav-item--active").count() === 1,
      "on /invoices the drawer re-opens inside Billing with Invoices active",
    );
    await page.screenshot({ path: `${folder}/drawer-reopened-invoices-390.png` });
  }));
