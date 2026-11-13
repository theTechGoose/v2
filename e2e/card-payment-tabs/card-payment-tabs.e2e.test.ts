/**
 * REQ-808 — Raphael, 2026-11-13: "make 3 tabs, one for square, one for stripe and one for custom
 * button." Settings' card payments are one section with three real tabs: they show in English and
 * Spanish; with nothing set up Square opens; the arrow keys move between them and each shows its
 * own provider's setup; connecting Square marks its tab and the Stripe tab then says to disconnect
 * Square first; Square, connected, is the tab that opens; the custom tab says its button waits
 * while Square is on; with Square off the custom link saves from its tab, its tab opens first, and
 * the customer's /i shows its button; a deep link opens the tab it names.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
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
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Tabs Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Acme Roofing",
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@acme-roofing.test" },
      },
    }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth, cookie: { name, value } };
}

async function mkInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  amount: number,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Ana Torres",
      email: "ana@blackhole.postmarkapp.com",
    }),
  })).json();
  return await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: "Roof repair",
      amount,
      issuedDate: "2026-11-01",
      dueDate: "2026-11-30",
    }),
  })).json();
}

const PORTAL = "https://buy.stripe.com/test_tabs_acme";

Deno.test("REQ-808: Settings → card payments is one section with Square | Stripe | Custom button tabs — en/es labels, the opening tab, the keyboard, one provider at a time, the custom link from its tab and on /i", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const tab = (k: string) => page.locator(`[data-cy='card-tab-${k}']`);
    const selected = async (k: string) =>
      await tab(k).getAttribute("aria-selected");
    const waitSelected = (k: string) =>
      page.waitForFunction(
        (k) =>
          document.querySelector(`[data-cy='card-tab-${k}']`)?.getAttribute(
            "aria-selected",
          ) === "true",
        k,
        { timeout: 15_000 },
      );

    // 1. three tabs; nothing set up → Square opens
    await page.goto("/settings");
    await page.locator("[data-cy='card-payments'] [role='tablist']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='card-payments'] [role='tab']").count(),
      3,
      "three tabs",
    );
    await expect.see("Square");
    await expect.see("Stripe");
    await expect.see("Custom button");
    await waitSelected("square");
    await page.locator("[data-cy='square-token']").waitFor({ timeout: 15_000 });
    expect.eq(await selected("stripe"), "false", "one tab selected");

    // 2. the keyboard: → Stripe (its form), → Custom button (the link field), Home → Square
    let moved = false;
    for (let i = 0; i < 20 && !moved; i++) {
      await tab("square").focus();
      await page.keyboard.press("ArrowRight");
      moved = (await selected("stripe")) === "true";
      if (!moved) await page.waitForTimeout(250);
    }
    expect(moved, "ArrowRight selects Stripe");
    await page.locator("[data-cy='stripe-pk']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='square-token']").isVisible(),
      false,
      "the Square form is put away",
    );
    await page.keyboard.press("ArrowRight");
    await waitSelected("link");
    await page.locator("[data-cy='pay-card-url']").waitFor({ timeout: 15_000 });
    await page.keyboard.press("Home");
    await waitSelected("square");

    // 3. Spanish labels
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    })).body?.cancel();
    const [cname, cvalue] = auth.cookie.split("=");
    await page.context().addCookies([
      { name: "pm_lang", value: "es", url: baseUrl },
      { name: cname, value: cvalue, url: baseUrl },
    ]);
    await page.goto("/settings");
    await tab("link").waitFor({ timeout: 15_000 });
    await expect.see("Botón propio");
    expect.eq(
      (await tab("square").textContent())?.includes("Square"),
      true,
      "Square in Spanish too",
    );
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "en" }),
    })).body?.cancel();
    await page.context().addCookies([
      { name: "pm_lang", value: "en", url: baseUrl },
    ]);

    // 4. connect Square in its tab → its tab is marked; the Stripe tab says disconnect Square first
    await page.goto("/settings");
    await page.locator("[data-cy='square-token']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='square-token']").fill("EAAAfake_acme");
    await page.locator("[data-cy='square-connect']").click();
    await page.locator("[data-cy='square-status']").waitFor({
      timeout: 15_000,
    });
    await tab("square").locator("[data-cy='card-tab-mark']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await tab("stripe").locator("[data-cy='card-tab-mark']").count(),
      0,
      "Stripe is not marked",
    );
    await tab("stripe").click();
    await page.locator("[data-cy='stripe-square-on']").waitFor({
      timeout: 15_000,
    });
    await expect.see("disconnect Square");
    expect.eq(
      await page.locator("[data-cy='stripe-pk']").isVisible(),
      false,
      "no Stripe form while Square is on",
    );

    // 5. Square connected is the tab that opens; the custom tab says its button waits
    await page.goto("/settings");
    await page.locator("[data-cy='square-status']").waitFor({
      timeout: 15_000,
    });
    await waitSelected("square");
    await tab("link").click();
    await page.locator("[data-cy='pay-card-link-note']").waitFor({
      timeout: 15_000,
    });
    await expect.see(
      "While Square is connected, customers pay by card through Square",
    );
    // the "Other payment links" card lives in this tab too
    await page.locator("[data-cy='pay-links-card']").waitFor({
      timeout: 15_000,
    });

    // 6. Square off; the custom link saves from its tab, marks it, and opens first next time
    await tab("square").click();
    await page.locator("[data-cy='square-disconnect']").click();
    await page.locator("[data-cy='square-connect']").waitFor({
      timeout: 15_000,
    });
    await tab("link").click();
    const url = page.locator("[data-cy='pay-card-url']");
    await url.waitFor({ timeout: 15_000 });
    await url.fill("http://buy.stripe.com/nope");
    await expect.see("The card payment link must be a full https:// address");
    await url.fill(PORTAL);
    await page.locator("[data-cy='pay-card-url-save']").click();
    let stored = "";
    for (let i = 0; i < 40 && stored !== PORTAL; i++) {
      const id = await (await http("/api/profile/identity", { headers: auth }))
        .json();
      stored = id?.acceptedPaymentMethods?.card?.url ?? "";
      if (stored !== PORTAL) await page.waitForTimeout(250);
    }
    expect.eq(stored, PORTAL, "the custom link is saved");
    await tab("link").locator("[data-cy='card-tab-mark']").waitFor({
      timeout: 15_000,
    });
    await page.goto("/settings");
    await page.locator("[data-cy='pay-card-url']").waitFor({ timeout: 15_000 });
    await waitSelected("link");
    expect.eq(
      await page.locator("[data-cy='pay-card-url']").inputValue(),
      PORTAL,
      "the link reads back",
    );

    // 7. a deep link opens the tab it names
    await page.goto("/settings#card-stripe");
    await page.locator("[data-cy='stripe-pk']").waitFor({ timeout: 15_000 });
    await waitSelected("stripe");

    // 8. the customer: no gateway on → the custom button
    const inv = await mkInvoice(http, auth, 6500);
    await page.context().clearCookies();
    await page.goto(`/i/${inv.id}`);
    const btn = page.locator("[data-cy='pay-by-card']");
    await btn.waitFor({ timeout: 15_000 });
    expect.eq(await btn.getAttribute("href"), PORTAL, "the custom button");
    await expect.see("Pay $65.00 by card");
  }));
