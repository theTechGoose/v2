/**
 * REQ-1141 (LOOP-007 cycle 3, q3-73) — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test, then one to fix it and
 * make it green." QA, at 390 px: a 308-character customer name was saved (200) and the customer
 * page's <h1 data-cy="cws-name"> wrapped to 486 px, taking over the phone screen. A customer name is
 * capped at 120 characters (inquiry-store's MAX_NAME): the API refuses longer, the New customer form's
 * Name and Business inputs carry maxlength=120, and the page heading never grows past two lines.
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
    body: JSON.stringify({ language: "en", name: "Name Length Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(page: StoryTools["page"], selector: string, done: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-1141 (q3-73): at 390x844 the New customer form's Name and Business inputs stop at 120 characters (maxlength=120)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(http, page, baseUrl);
    await page.goto("/customers");
    await page.locator(".ph2__cta").waitFor({ timeout: 20_000 });
    const form = page.locator("[data-cy='customer-form']");
    await clickUntil(page, ".ph2__cta", async () => (await form.count()) > 0 && await form.first().isVisible());
    const name = form.locator("[data-cy='cf-name']");
    const business = form.locator("[data-cy='cf-business']");
    await name.waitFor({ timeout: 10_000 });
    await name.fill("Z".repeat(308));
    await business.fill("Y".repeat(308));
    // one read: both attributes and both values
    const facts = await form.evaluate((el) => {
      const n = el.querySelector("[data-cy='cf-name']") as HTMLInputElement;
      const b = el.querySelector("[data-cy='cf-business']") as HTMLInputElement;
      return {
        nameMax: n.getAttribute("maxlength"),
        businessMax: b.getAttribute("maxlength"),
        nameLen: n.value.length,
        businessLen: b.value.length,
      };
    });
    expect.eq(facts.nameMax, "120", `the Name input carries maxlength=120 (${JSON.stringify(facts)})`);
    expect.eq(facts.businessMax, "120", `the Business input carries maxlength=120 (${JSON.stringify(facts)})`);
    expect.eq(facts.nameLen, 120, "typing 308 characters into Name keeps 120");
    expect.eq(facts.businessLen, 120, "typing 308 characters into Business keeps 120");
  }));

Deno.test("REQ-1141 (q3-73): POST /api/customers refuses a 308-character name with 400 customer.nameTooLong", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const tooLong = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "<b>x</b>" + "Z".repeat(300) }),
    });
    const tooLongBody = await tooLong.text();
    expect.eq(tooLong.status, 400, `a 308-character name is refused (${tooLongBody.slice(0, 120)})`);
    expect(tooLongBody.includes("customer.nameTooLong"), `the refusal names customer.nameTooLong (${tooLongBody.slice(0, 120)})`);
  }));

Deno.test("REQ-1141 (q3-73): at 390x844 a 120-character name heads the customer page in at most two lines (h1 under 80 px), full name in its title", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const auth = await signIn(http, page, baseUrl);

    // the longest name the API keeps: real words, so it wraps like a real long name
    const words = "Bartholomew Fitzgerald Montgomery Wellington Ashford Kensington Harrington Pemberton Whitmore Castellanos Rivera";
    const longest = (words + " " + words).slice(0, 120).trim();
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: longest }),
    });
    const c = await r.json();
    if (!r.ok) throw new Error(`POST /api/customers → ${r.status} ${JSON.stringify(c)}`);

    await page.goto(`/customers/${c.id}`);
    const h1 = page.locator(`[data-cy='customer-workspace'][data-customer='${c.id}'] [data-cy='cws-name']`);
    await h1.waitFor({ timeout: 20_000 });
    const facts = await h1.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { height: r.height, right: r.right, title: el.getAttribute("title") };
    });
    expect(facts.height < 80, `the name heading is at most two lines at 390 px (${facts.height} px tall)`);
    expect(facts.right <= 390 + 0.5, `the heading stays on screen (right edge ${facts.right})`);
    expect.eq(facts.title, longest, "the clamped heading keeps the full name in its title");
  }));
