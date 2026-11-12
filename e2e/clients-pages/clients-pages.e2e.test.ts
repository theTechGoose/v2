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
    await expect.see("Client 07");
    for (let i = 0; i < 50 && (await cards.count()) !== 1; i++) await page.waitForTimeout(100);
    expect((await cards.count()) === 1, `one card for the search (${await cards.count()})`);
    // REQ-419 (demo-loop cycle 2, p13-k): one page of results has no pager — no "Page 1 of 1"
    await expect.notSee("Page 1 of 1");
    expect((await page.locator("[data-cy='clients-pager']").count()) === 0, "no pager for one page");
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

Deno.test("REQ-279 (demo M32): the customers search is accent-blind — 'maria' finds María José Peña, 'pena' finds her too", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    for (const name of ["María José Peña", "Bob Smith"]) {
      const r = await http("/api/customers", { method: "POST", headers: auth, body: JSON.stringify({ name }) });
      await r.body?.cancel();
    }
    await page.goto("/customers");
    await expect.see("2 on the books");
    const cards = page.locator(".ccard2");
    for (const q of ["maria", "pena"]) {
      await page.locator("[data-cy='clients-search']").fill(q);
      for (let i = 0; i < 25 && (await cards.count()) !== 1; i++) await page.waitForTimeout(200);
      expect((await cards.count()) === 1, `one card for "${q}" (${await cards.count()})`);
      await expect.see("María José Peña");
    }
  }));

Deno.test("REQ-519 (demo cycle 3, M33): the customers search matches word by word — 'maria pena' finds María José Peña (middle name skipped)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    for (const name of ["María José Peña", "Bob Smith"]) {
      const r = await http("/api/customers", { method: "POST", headers: auth, body: JSON.stringify({ name }) });
      await r.body?.cancel();
    }
    await page.goto("/customers");
    await expect.see("2 on the books");
    const cards = page.locator(".ccard2");
    await page.locator("[data-cy='clients-search']").fill("maria pena");
    for (let i = 0; i < 25 && (await cards.count()) !== 1; i++) await page.waitForTimeout(200);
    expect((await cards.count()) === 1, `one card for "maria pena" (${await cards.count()})`);
    await expect.see("María José Peña");
  }));

Deno.test("REQ-419 (demo-loop cycle 2: m40, S7c, p13-k): one customer — no pager; the closed back is hidden from AT; the open back shows every row unclipped", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Dana Reyes", phoneNumber: "(512) 555-3150", email: "dana@blackhole.postmarkapp.com", address: "8807 Spicewood Springs Rd, Austin, TX 78759" }),
    });
    await r.body?.cancel();
    await page.goto("/customers");
    await expect.see("Dana Reyes");
    // p13-k: a single page has no "Page 1 of 1" floating in the grid
    await expect.notSee("Page 1 of 1");
    expect((await page.locator("[data-cy='clients-pager']").count()) === 0, "no pager for one page");

    const card = page.locator(".ccard2", { hasText: "Dana Reyes" });
    const panel = card.locator(".ccard2__panel");
    // S7c: the closed back is out of the accessibility tree and the tab order
    expect((await panel.getAttribute("aria-hidden")) === "true", "the closed back is aria-hidden");
    expect((await panel.evaluate((el) => (el as HTMLElement).inert)) === true, "the closed back is inert");
    const snap = await page.locator("body").ariaSnapshot();
    expect(!snap.includes("dana@blackhole.postmarkapp.com"), "the closed back's email is not in the accessibility snapshot");

    await clickUntil(page, ".ccard2:has-text('Dana Reyes') .ccard2__name", async () =>
      (await card.getAttribute("class"))?.includes("ccard2--open") ?? false);
    await page.waitForTimeout(500); // the panel's slide-up transition
    expect((await panel.getAttribute("aria-hidden")) === null, "the open back is exposed to AT");
    expect((await panel.evaluate((el) => (el as HTMLElement).inert)) === false, "the open back is not inert");

    // m40: no row group is squeezed below its content, and every row is reachable inside the panel
    const groups = await panel.locator(".ccard2__panel-rows").evaluateAll((els) =>
      els.map((el) => ({ cy: el.getAttribute("data-cy") ?? "contact", client: el.clientHeight, scroll: el.scrollHeight }))
    );
    expect(groups.length === 3, `contact, subscriptions and documents groups (${JSON.stringify(groups)})`);
    for (const g of groups) {
      expect(g.scroll <= g.client + 1, `the ${g.cy} group shows all its rows: ${JSON.stringify(g)}`);
    }
    const docs = panel.locator("[data-cy='ccard2-docs']");
    await docs.scrollIntoViewIfNeeded();
    const fits = await panel.evaluate((el) => {
      const p = el.getBoundingClientRect();
      const d = el.querySelector("[data-cy='ccard2-docs']")!.getBoundingClientRect();
      return { panelTop: p.top, panelBottom: p.bottom, docsTop: d.top, docsBottom: d.bottom };
    });
    expect(
      fits.docsTop >= fits.panelTop - 1 && fits.docsBottom <= fits.panelBottom + 1,
      `the DOCUMENTS group scrolls fully into the panel: ${JSON.stringify(fits)}`,
    );
    await expect.see("8807 Spicewood Springs Rd, Austin, TX 78759");
  }));

Deno.test("REQ-432 (demo m40, cycle 3): with a customer card open, switching EN/ES in the topbar keeps it open", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", { method: "POST", headers: auth, body: JSON.stringify({ name: "Linda Lang", phoneNumber: "(512) 555-3151" }) });
    await r.body?.cancel();
    await page.goto("/customers");
    await expect.see("Linda Lang");
    const card = page.locator(".ccard2", { hasText: "Linda Lang" });
    const isOpen = async () => (await card.getAttribute("class"))?.includes("ccard2--open") ?? false;
    await clickUntil(page, ".ccard2:has-text('Linda Lang') .ccard2__name", isOpen);
    expect(await isOpen(), "the card opened");
    await clickUntil(page, "[data-cy='topbar-lang-es']", async () =>
      (await page.locator("[data-cy='topbar-lang-es']").getAttribute("aria-pressed")) === "true");
    await page.waitForTimeout(300);
    expect(await isOpen(), "the card is still open after ES");
    await page.locator("[data-cy='topbar-lang-en']").click();
    await page.waitForTimeout(300);
    expect(await isOpen(), "the card is still open after EN");
    // a click on the page outside the card still closes it (the outside-click dismiss is kept)
    await page.locator(".ph2__crumb").click();
    for (let i = 0; i < 20 && (await isOpen()); i++) await page.waitForTimeout(100);
    expect(!(await isOpen()), "a click outside the card on the page closes it");
  }));
