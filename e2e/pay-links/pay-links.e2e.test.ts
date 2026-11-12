/**
 * REQ-630 — every way the business gets paid, one tap away. The business has Venmo, Cash App and
 * Zelle on, adds its own "Extra Pay" link in Settings (an http:// link is refused there), and
 * connects its own Stripe (fake keys). The customer's /i/:id shows, in order: the card (the
 * primary), the Venmo / Cash App buttons with the amount in their links, the Extra Pay button,
 * Zelle to copy, then the manual "I sent it" claim. The card pays on the fake gateway and the
 * invoice turns paid.
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
    body: JSON.stringify({ language: "en", name: "Alexander Jerez" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "A2Z Landscape",
      acceptedPaymentMethods: {
        venmo: { enabled: true, handle: "@a2z-landscape" },
        cashapp: { enabled: true, cashtag: "$a2zlandscape" },
        zelle: { enabled: true, handle: "pay@a2z.test" },
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
  return { auth };
}

Deno.test("REQ-630: Venmo + Cash App + a custom 'Extra Pay' link — /i/:id shows the card first, then the app and link buttons with the amount in their hrefs, then 'I sent it'; the card pays on the fake gateway", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);

    // 1. Settings: add "Extra Pay" — an http:// link is refused, https is saved
    await page.goto("/settings");
    const card = page.locator("[data-cy='pay-links-card']");
    await card.waitFor({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();
    await page.locator("[data-cy='pay-link-name']").fill("Extra Pay");
    await page.locator("[data-cy='pay-link-url']").fill(
      "http://extrapay.example/a2z",
    );
    await page.locator("[data-cy='pay-link-add']").click();
    await expect.see("The link must start with https:// (secure).");
    await page.locator("[data-cy='pay-link-url']").fill(
      "https://extrapay.example/a2z",
    );
    await page.locator("[data-cy='pay-link-add']").click();
    await page.locator("[data-cy^='pay-link-row-']").waitFor({
      timeout: 15_000,
    });
    await expect.see("https://extrapay.example/a2z");
    const identity =
      await (await http("/api/profile/identity", { headers: auth })).json();
    const links = identity.acceptedPaymentMethods.links as Array<
      { id: string; name: string; url: string }
    >;
    expect.eq(links.length, 1, "one link stored");
    expect.eq(links[0].name, "Extra Pay", "by its name");
    expect.eq(
      identity.acceptedPaymentMethods.venmo.handle,
      "@a2z-landscape",
      "Venmo untouched by the links card",
    );
    // the link survives a reload
    await page.goto("/settings");
    await page.locator(`[data-cy='pay-link-row-${links[0].id}']`).waitFor({
      timeout: 15_000,
    });

    // 2. the business's own Stripe (fake keys)
    const s = await http("/api/me/stripe", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        publishableKey: "pk_test_fake_a2z",
        secretKey: "sk_test_fake_a2z",
      }),
    });
    expect.eq(s.status, 200, "stripe connected");
    await s.body?.cancel();

    // 3. an invoice for $65.00
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Torres",
        email: "ana@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Lawn care",
        amount: 6500,
        issuedDate: "2026-11-01",
        dueDate: "2026-11-30",
      }),
    })).json();
    const office0 =
      await (await http(`/api/invoices/${inv.id}`, { headers: auth })).json();
    const number = String(office0.number ?? "");

    // 4. the customer's page
    await page.context().clearCookies();
    await page.goto(`/i/${inv.id}`);
    await page.locator("[data-cy='card-pay']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='pay-buttons']").waitFor({ timeout: 15_000 });

    const venmo = page.locator("[data-cy='pay-venmo']");
    const cashapp = page.locator("[data-cy='pay-cashapp']");
    const extra = page.locator(`[data-cy='pay-link-${links[0].id}']`);
    expect.eq(
      await venmo.getAttribute("href"),
      `https://venmo.com/a2z-landscape?txn=pay&amount=65.00${
        number ? `&note=${encodeURIComponent(number)}` : ""
      }`,
      "Venmo opens on the amount",
    );
    expect.eq(
      await cashapp.getAttribute("href"),
      "https://cash.app/$a2zlandscape/65.00",
      "Cash App opens on the amount",
    );
    expect.eq(
      await extra.getAttribute("href"),
      "https://extrapay.example/a2z",
      "the custom link",
    );
    expect.eq(await extra.getAttribute("target"), "_blank", "opens a new tab");
    expect.eq(
      await extra.getAttribute("rel"),
      "noopener noreferrer",
      "never hands the page to the link",
    );
    await expect.see("Pay $65.00 with Venmo");
    await expect.see("Pay $65.00 with Cash App");
    await expect.see("Pay with Extra Pay");
    await expect.see("Send to pay@a2z.test");
    expect.eq(
      await page.locator("[data-cy='pay-zelle-copy']").count(),
      1,
      "Zelle has a copy button",
    );

    // the order: card, then the buttons, then the manual claim
    const order = await page.evaluate(() => {
      const all = [...document.querySelectorAll("[data-cy]")].map((e) =>
        e.getAttribute("data-cy")
      );
      return {
        card: all.indexOf("card-pay"),
        buttons: all.indexOf("pay-buttons"),
        claim: all.indexOf("claim-method-venmo"),
      };
    });
    expect(order.card >= 0 && order.card < order.buttons, "the card first");
    expect(
      order.buttons < order.claim,
      "the app/link buttons before 'I sent it'",
    );
    await expect.see("Already paid? Tell us how");
    expect.eq(
      await page.locator(`[data-cy='claim-method-link-${links[0].id}']`)
        .count(),
      1,
      "Extra Pay can be claimed too",
    );

    // nothing clipped: every button's text fits its box
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll(
        "[data-cy='pay-buttons'] [data-cy^='pay-']",
      )]
        .filter((el) =>
          (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1
        )
        .map((el) => el.getAttribute("data-cy"))
    );
    expect.eq(clipped.length, 0, `no clipped button (${clipped.join(",")})`);
    // Zelle: the copy button copies and says so
    await page.locator("[data-cy='pay-buttons']").scrollIntoViewIfNeeded();
    await page.locator("[data-cy='pay-zelle-copy']").click();
    await expect.see("Copied");
    // on a phone the buttons still fit
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator("[data-cy='pay-buttons']").scrollIntoViewIfNeeded();
    const phoneClipped = await page.evaluate(() =>
      [...document.querySelectorAll(
        "[data-cy='pay-buttons'] [data-cy^='pay-']",
      )]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (el as HTMLElement).scrollWidth >
              (el as HTMLElement).clientWidth + 1 ||
            r.right > globalThis.innerWidth;
        })
        .map((el) => el.getAttribute("data-cy"))
    );
    expect.eq(
      phoneClipped.length,
      0,
      `no clipped button on a phone (${phoneClipped.join(",")})`,
    );
    await page.locator("[data-cy='pay-zelle-copy']").click();
    await page.setViewportSize({ width: 1280, height: 720 });

    // 5. the card pays on the fake gateway; the invoice is paid
    await page.locator("[data-cy='card-number']").fill("4242424242424242");
    await page.locator("[data-cy='card-holder']").fill("Ana Torres");
    await page.locator("[data-cy='card-expiry']").fill("1234");
    await page.locator("[data-cy='card-cvc']").fill("123");
    await page.locator("[data-cy='card-pay-submit']").click();
    await page.locator("[data-cy='card-paid']").waitFor({ timeout: 15_000 });
    const office =
      await (await http(`/api/invoices/${inv.id}`, { headers: auth })).json();
    expect.eq(office.status, "paid", "the invoice is paid");
  }));
