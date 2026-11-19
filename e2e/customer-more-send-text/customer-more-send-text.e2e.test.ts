/**
 * REQ-1108 (LOOP-007 q3, q3-33) — Raphael: "test every single aspect of this application … one Opus
 * agent per issue to do root cause analysis, then one to write the test, then one to fix it and make it
 * green." QA: More → "Send a text" with no phone line is a dead end or does nothing visible. The More
 * item was always "💬 Send a text" and its click only swapped the tab body, which opens below the KPI
 * grid, out of view. The checks, at a 1280x720 laptop viewport:
 *  1. no line, customer with a phone → the More item says to get a line and leads to /communications;
 *  2. a line (stubbed /communications/line) and a phone → More → Send a text puts cws-messages inside
 *     the viewport with the composer focused;
 *  3. a line but no phone → the More item says to add a phone and opens the edit dialog.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Luis Ortega", language: "en" }],
      ["/api/profile/identity", { businessName: "Ortega Handyman Services" }],
    ] as const
  ) {
    await (await http(path, { method: "PUT", headers: auth, body: JSON.stringify(payload) })).body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
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


/** the business has a line: stub the two comms reads the Messages tab (and the workspace) make */
async function stubLine(page: StoryTools["page"]) {
  await page.route(/\/communications\/line(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        line: {
          id: "line-1",
          userId: "u",
          kind: "subaccount",
          subaccountSid: "AC0",
          number: "+15125550100",
          numberSid: "PN0",
          apiKeySid: "SK0",
          twimlAppSid: "AP0",
          status: "active",
          createdAt: new Date().toISOString(),
        },
      }),
    }));
  await page.route(/\/communications\/threads\/[^/?]+(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        thread: { peer: "+15125550142", lastAt: new Date().toISOString(), unread: 0 },
        texts: [],
        calls: [],
      }),
    }));
}

async function newCustomer(http: StoryTools["http"], auth: Record<string, string>, payload: Record<string, unknown>) {
  const r = await http("/api/customers", { method: "POST", headers: auth, body: JSON.stringify(payload) });
  const c = await r.json();
  if (!r.ok) throw new Error(`/api/customers → ${r.status} ${JSON.stringify(c)}`);
  return c as { id: string };
}

async function openMore(page: StoryTools["page"], id: string) {
  await page.goto(`/customers/${id}`);
  await page.locator(`[data-cy='customer-workspace'][data-customer='${id}']`).waitFor({ timeout: 20_000 });
  const menu = page.locator("[data-cy='cws-menu']");
  await clickUntil(page, "[data-cy='cws-more']", async () => (await menu.count()) > 0);
  // the first menu item is the text one (Send a text / its gated wording)
  return menu.locator("[role='menuitem']").first();
}

Deno.test("REQ-1108 q3-33: with no phone line, the More menu's text item says to get a line and leads to /communications, not a bare 'Send a text'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 720 });
    const ana = await newCustomer(http, auth, { name: `Ana Ruiz ${digits()}`, phoneNumber: "(512) 555-0142" });
    const item = await openMore(page, ana.id);
    await page.waitForTimeout(1_500); // the workspace's line lookup settles
    const facts = await item.evaluate((el) => ({
      text: (el.textContent ?? "").trim(),
      href: el.getAttribute("href") ?? "",
    }));
    expect(
      /get a phone line/i.test(facts.text),
      `with no line the item tells the owner to get a phone line (got "${facts.text}")`,
    );
    expect(
      facts.href.startsWith("/communications"),
      `with no line the item leads to /communications (href "${facts.href}", text "${facts.text}")`,
    );
  }));

Deno.test("REQ-1108 q3-33: with a line and a phone, More → Send a text brings the Messages card into view and focuses the composer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 720 });
    await stubLine(page);
    const ana = await newCustomer(http, auth, { name: `Ana Ruiz ${digits()}`, phoneNumber: "(512) 555-0142" });
    await openMore(page, ana.id);
    const messages = page.locator("[data-cy='cws-messages']");
    await clickUntil(
      page,
      "[data-cy='cws-menu'] [role='menuitem']:has-text('Send a text')",
      async () => (await messages.count()) > 0,
    );
    await page.waitForTimeout(1_000); // a smooth scroll / focus lands
    // one read: where the card sits and what has focus
    const facts = await messages.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const a = document.activeElement;
      return {
        top: Math.round(r.top),
        innerHeight: globalThis.innerHeight,
        focusInCompose: !!a && !!a.closest(".cws-compose") && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"),
        active: a ? `${a.tagName}.${(a as HTMLElement).className}` : "none",
      };
    });
    expect(
      facts.top >= 0 && facts.top < facts.innerHeight,
      `the Messages card's top is inside the viewport (top ${facts.top}, innerHeight ${facts.innerHeight})`,
    );
    expect(facts.focusInCompose, `the composer has focus (active element: ${facts.active})`);
  }));

Deno.test("REQ-1108 q3-33: with a line but no customer phone, the More item says to add a phone and opens the edit dialog", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 720 });
    await stubLine(page);
    const tom = await newCustomer(http, auth, { name: `Tom Becker ${digits()}`, email: "tom@blackhole.postmarkapp.com" });
    const item = await openMore(page, tom.id);
    await page.waitForTimeout(1_500);
    const text = ((await item.textContent()) ?? "").trim();
    expect(/add a phone/i.test(text), `with no phone the item says to add a phone (got "${text}")`);
    if (!/add a phone/i.test(text)) return;
    const edit = page.locator("[data-cy='customer-form'][data-mode='edit']");
    await clickUntil(page, "[data-cy='cws-menu'] [role='menuitem']:has-text('Add a phone')", async () =>
      (await edit.count()) > 0);
    expect((await edit.count()) > 0, "the edit dialog opens");
  }));
