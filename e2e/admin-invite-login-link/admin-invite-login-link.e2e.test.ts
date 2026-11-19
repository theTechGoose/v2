/**
 * REQ-1061 (LOOP-007 cycle 2, q2-49) — amends REQ-146 / REQ-601: the editor
 * invite's sign-in link opens the sign-in page in the owner's language. QA
 * invited an editor on /admins; the text said "Sign in with this number at
 * http://localhost:5280", and a fresh browser opened the marketing page, in
 * Spanish, for an English owner.
 *
 * On the real pages: an English owner invites an editor at a reserved
 * 555-01XX number (REQ-523: not texted, so /admins shows the link to share,
 * the same `signInUrl` the SMS carries). The link is `/login?lang=en`; opened
 * in a fresh, signed-out browser that asks for Spanish, it is the sign-in
 * page, in English.
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const area = () => String(200 + Math.floor(Math.random() * 700));
const two = () => String(Math.floor(Math.random() * 100)).padStart(2, "0");

Deno.test("REQ-1061 (LOOP-007 q2-49): the editor invite link opens /login in the owner's language, not the marketing page", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // an English owner, signed in with the dev master code
    const r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
    await (await http("/api/me", {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie },
      body: JSON.stringify({ language: "en", name: "Dana Ruiz" }),
    })).body?.cancel();
    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]));

    // invite an editor on /admins
    await page.goto("/admins");
    await page.locator("[data-cy='adm-phone']").fill(`${area()}55501${two()}`);
    await page.locator("[data-cy='adm-name']").fill("Carol Miller");
    const invite = page.locator("[data-cy='adm-invite']:not([disabled])");
    await invite.waitFor({ timeout: 20_000 });
    await invite.click();
    await page.locator("[data-cy='adm-share']").waitFor({ timeout: 15_000 });
    const shared = (await page.locator("[data-cy='adm-share-url']").innerText())
      .trim();
    const link = new URL(shared);
    expect.eq(
      link.pathname,
      "/login",
      `the invite link goes to the sign-in page (got "${shared}")`,
    );
    expect.eq(
      link.searchParams.get("lang"),
      "en",
      `the invite link carries the owner's language (got "${shared}")`,
    );

    // the invitee opens it signed out, in a browser that asks for Spanish
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const fresh = await browser.newContext({
      locale: "es-ES",
      extraHTTPHeaders: { "accept-language": "es-ES,es;q=0.9" },
      viewport: { width: 390, height: 844 },
    });
    try {
      const p = await fresh.newPage();
      await p.goto(`${baseUrl}${link.pathname}${link.search}`);
      await p.waitForLoadState("domcontentloaded");
      expect.eq(
        new URL(p.url()).pathname,
        "/login",
        `the invitee lands on the sign-in page (at "${p.url()}")`,
      );
      expect.eq(
        await p.locator("html").getAttribute("lang"),
        "en",
        "the sign-in page is in the owner's language, not the browser's",
      );
    } finally {
      await fresh.close();
    }
  }));
