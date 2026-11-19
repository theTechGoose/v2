/**
 * REQ-999 (LOOP-007 cycle 1, q1-77) — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test, then one to fix it and
 * make it green." QA, at phone size on a Spanish customer page: "Más" followed by a red missing-glyph
 * box instead of ▾. The caret was a literal U+25BE; the app's web fonts have no Geometric Shapes
 * (REQ-366/407), so it must be an inline SVG <Icon name="chevron-down">. Whether the box draws
 * depends on the browser's fonts, so this asserts the markup, not the pixels (as invoice-card-c2).
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es", name: "Caret Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "es", domain, path: "/" },
  ]));
  return auth;
}

Deno.test("REQ-999 (q1-77): at 390x844 the customer page's 'Más' button draws its caret as an SVG chevron-down, never a literal ▾", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const auth = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: `Ana Caret ${digits()}` }),
    });
    const ana = await r.json();
    if (!r.ok) throw new Error(`POST /api/customers → ${r.status} ${JSON.stringify(ana)}`);

    await page.goto(`/customers/${ana.id}`);
    const more = page.locator(`[data-cy='customer-workspace'][data-customer='${ana.id}'] [data-cy='cws-more']`);
    await more.waitFor({ timeout: 20_000 });
    // one read: the label, the markup, and whether it is on screen
    const facts = await more.evaluate((el) => ({
      text: el.textContent ?? "",
      svg: el.querySelectorAll("svg[data-icon='chevron-down']").length,
      html: el.innerHTML,
    }));
    expect(facts.text.includes("Más"), `the button is the Spanish "Más" (${JSON.stringify(facts.text)})`);
    expect.eq(
      facts.text.match(/[✀-➿■-◿]/u)?.[0] ?? null,
      null,
      `no glyph the web fonts lack in the button's text — it draws as a tofu box (${JSON.stringify(facts.text)})`,
    );
    expect.eq(facts.svg, 1, `the caret is one <svg data-icon="chevron-down"> (${facts.html})`);
  }));
