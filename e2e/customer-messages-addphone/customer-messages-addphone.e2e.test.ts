/**
 * REQ-1076 (LOOP-007 q2, q2-64) — "'Send a message' on an email-only customer is a dead end".
 * The tester opened Tom Becker (email, no phone) → More → Send a text and landed on a Messages tab
 * whose card only said "This customer has no phone number on file." — no way to add the phone, no
 * way to email her. The check: an email-only customer → More → Send a text (or the Messages tab when
 * the item is no longer offered) → the no-phone card carries an add-phone control → clicking it opens
 * the customer edit dialog → saving a phone there → the Messages tab no longer shows the no-phone
 * note, it shows the compose box or the get-a-line pitch instead.
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

Deno.test("REQ-1076 q2-64: an email-only customer's More → Send a text offers Add phone, which opens the edit dialog and, once saved, leaves the no-phone note behind", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const tag = digits();

    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: `Tom Becker ${tag}`, email: "tom@blackhole.postmarkapp.com" }),
    });
    const tom = await r.json();
    if (!r.ok) throw new Error(`/api/customers → ${r.status} ${JSON.stringify(tom)}`);

    await page.goto(`/customers/${tom.id}`);
    await page.locator(`[data-cy='customer-workspace'][data-customer='${tom.id}']`).waitFor({ timeout: 20_000 });

    // More → Send a text (the path the tester took); if the item is no longer offered without a
    // phone, the Messages tab is the other way in
    const menu = page.locator("[data-cy='cws-menu']");
    await clickUntil(page, "[data-cy='cws-more']", async () => (await menu.count()) > 0);
    const sendText = menu.locator("[role='menuitem']", { hasText: "Send a text" });
    const noPhone = page.locator("[data-cy='cws-msg-nophone']");
    if (await sendText.count() > 0) {
      await clickUntil(page, "[data-cy='cws-menu'] [role='menuitem']:has-text('Send a text')", async () =>
        (await noPhone.count()) > 0 || (await page.locator("[data-cy='customer-form'][data-mode='edit']").count()) > 0);
    } else {
      await page.keyboard.press("Escape");
      await clickUntil(page, "[data-cy='cws-tab-messages']", async () => (await noPhone.count()) > 0);
    }

    const edit = page.locator("[data-cy='customer-form'][data-mode='edit']");
    if ((await edit.count()) === 0) {
      await noPhone.waitFor({ timeout: 15_000 });
      const addPhone = noPhone.locator("[data-cy='cws-msg-addphone']");
      const n = await addPhone.count();
      expect(
        n > 0,
        `the no-phone card offers an add-phone control (data-cy=cws-msg-addphone); it only says: "${
          ((await noPhone.textContent()) ?? "").trim()
        }"`,
      );
      if (n === 0) return;
      await clickUntil(page, "[data-cy='cws-msg-addphone']", async () => (await edit.count()) > 0);
    }

    await edit.waitFor({ timeout: 10_000 });
    await edit.locator("[data-cy='cf-phone']").fill("(512) 555-0142");
    const saved = page.waitForResponse(
      (res) => res.url().includes(`/customers/${tom.id}`) && res.request().method() === "PUT",
      { timeout: 15_000 },
    );
    await edit.locator("[data-cy='cf-save']").click();
    const res = await saved;
    expect(res.ok(), `saving the phone succeeds (${res.status()})`);
    await edit.waitFor({ state: "detached", timeout: 10_000 });

    await clickUntil(
      page,
      "[data-cy='cws-tab-messages']",
      async () =>
        (await page.locator("[data-cy='cws-msg-noline'], [data-cy='cws-messages']").count()) > 0,
    );
    expect.eq(await noPhone.count(), 0, "with a phone saved, the no-phone note is gone");
  }));
