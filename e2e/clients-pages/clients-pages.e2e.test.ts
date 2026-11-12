/**
 * REQ-135 — "we need to paginate this information via the api cause customers take a long time to
 * load now and its affecting other pages too."
 * The page: /customers (front-end/routes/clients/index.tsx → islands/ClientsPage.tsx + ClientsBoard.tsx),
 * reading one page at a time from GET /api/clients.
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
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en", name: "Pager Story" }) });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [{ name, value, domain, path: "/" }, { name: "pm_lang", value: "en", domain, path: "/" }]));
  return { auth };
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // the button is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-135: thirty customers — the page shows twenty-five, says Page 1 of 2, next shows five, a search shows one, the crumb counts thirty", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    for (let i = 1; i <= 30; i++) {
      const r = await http("/api/customers", { method: "POST", headers: auth, body: JSON.stringify({ name: `Client ${String(i).padStart(2, "0")}`, email: `client${i}@blackhole.postmarkapp.com` }) });
      await r.body?.cancel();
    }
    await page.goto("/customers");
    await expect.see("30 on the books");
    await expect.see("Page 1 of 2");
    const cards = page.locator(".ccard2");
    await page.locator("[data-cy='clients-next']").waitFor();
    expect((await cards.count()) === 25, `twenty-five cards on page one (${await cards.count()})`);
    await expect.see("Client 01");
    // the island may still be hydrating when the button appears (REQ-135 REVISION: under the
    // full lane's load the click landed on the dead SSR button and page two never came)
    await clickUntil(page, "[data-cy='clients-next']", async () =>
      (await page.locator("body").innerText()).includes("Page 2 of 2"));
    await expect.see("Page 2 of 2");
    await expect.see("Client 30");
    expect((await cards.count()) === 5, `five cards on page two (${await cards.count()})`);
    await page.locator("[data-cy='clients-search']").fill("client 07");
    await expect.see("Page 1 of 1");
    await expect.see("Client 07");
    expect((await cards.count()) === 1, `one card for the search (${await cards.count()})`);
    await expect.see("30 on the books");
  }));

Deno.test("REQ-274: /customers in English — the tab title, the sidebar and the crumb all say Customers (demo i18n-formatting-m12)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/customers");
    await expect.see("0 on the books");
    const title = await page.title();
    expect(title === "Customers · DocuMonster", `the tab title says Customers (${title})`);
    // the crumb is CSS-uppercased, so read its source text, not innerText
    const crumb = (await page.locator(".ph2__crumb").textContent())?.trim() ?? "";
    expect(crumb === "Customers · 0 on the books", `the hero crumb says Customers (${crumb})`);
    const body = await page.locator("body").innerText();
    expect(!/\bclients?\b/i.test(body), "no client(s) anywhere on the English page");
    expect(body.includes("Customers"), "the sidebar label says Customers");
  }));

Deno.test("REQ-277 (M31): the card's nudge and the panel's Message text the customer; 'Open card' opens the card; nothing on the card is inert", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // a regular customer with a phone (the nudge reads "Open card"), and one with no contact at all
    for (const body of [
      { name: "Phone Pat", phoneNumber: "(512) 555-3150" },
      { name: "Nocontact Nell" },
    ]) {
      const r = await http("/api/customers", { method: "POST", headers: auth, body: JSON.stringify(body) });
      await r.body?.cancel();
    }
    await page.goto("/customers");
    await expect.see("Phone Pat");
    const pat = page.locator(".ccard2", { hasText: "Phone Pat" });
    const nell = page.locator(".ccard2", { hasText: "Nocontact Nell" });

    // every action on a card is a link or a button with somewhere to go
    const nudge = pat.locator("[data-cy='ccard2-nudge']");
    await nudge.waitFor();
    const nudgeLabel = (await nudge.innerText()).trim();
    const nudgeHref = await nudge.getAttribute("href");
    if (nudgeLabel.startsWith("Open card")) {
      expect(nudgeHref === null, `"Open card" opens the card, not a link (${nudgeHref})`);
      await clickUntil(page, ".ccard2:has-text('Phone Pat') [data-cy='ccard2-nudge']", async () =>
        (await pat.getAttribute("class"))?.includes("ccard2--open") ?? false);
    } else {
      expect(nudgeHref === "sms:+15125553150", `"${nudgeLabel}" texts Pat (${nudgeHref})`);
      await clickUntil(page, ".ccard2:has-text('Phone Pat') .ccard2__name", async () =>
        (await pat.getAttribute("class"))?.includes("ccard2--open") ?? false);
    }
    // the open panel's Message texts Pat; there is no dead "Open card" in it
    const msg = pat.locator("[data-cy='ccard2-message']");
    await msg.waitFor();
    expect((await msg.getAttribute("href")) === "sms:+15125553150", `Message texts Pat (${await msg.getAttribute("href")})`);
    expect((await pat.locator(".ccard2__panel-actions", { hasText: "Open card" }).count()) === 0, "no 'Open card' in the panel");

    // Nell has no phone or email: her nudge opens her card and her panel offers no Message
    await page.keyboard.press("Escape");
    const nellNudge = nell.locator("[data-cy='ccard2-nudge']");
    expect((await nellNudge.getAttribute("href")) === null, "Nell's nudge has nowhere to send a text");
    await clickUntil(page, ".ccard2:has-text('Nocontact Nell') [data-cy='ccard2-nudge']", async () =>
      (await nell.getAttribute("class"))?.includes("ccard2--open") ?? false);
    expect((await nell.locator("[data-cy='ccard2-message']").count()) === 0, "no Message for a customer with no contact");

    // nothing inert left on the card: every card button has a handler (clicked → something changed is the
    // nudge above; here the static check that no ccard2 button is a bare mock button)
    const inert = await page.evaluate(() =>
      [...document.querySelectorAll(".ccard2 button")].filter((b) => !(b as HTMLElement).dataset.cy && !b.classList.contains("ccard2__panel-x")).length
    );
    expect(inert === 0, `no unlabelled, unwired button left on a card (${inert})`);
  }));
