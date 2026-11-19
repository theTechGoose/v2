/**
 * REQ-1043 (LOOP-007 cycle 2, q2-27) — "Settings accepts a junk website, which becomes a dead
 * link on the customer's invoice". QA typed "reyes tile dot com" into Settings → SITIO WEB; it
 * saved on blur with no error (the email field next to it IS validated) and showed up as a dead
 * link on the customer's /i invoice. In a browser: the blur shows an inline error under the field
 * (data-cy=settings-website-error, aria-invalid=true), no PUT is sent, the stored website stays
 * the previous valid one, and the customer's /i/:id still links to it.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const GOOD = "https://reyestile.com";
const JUNK = "reyes tile dot com";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
    body: JSON.stringify({
      language: "en",
      name: "Rosa Reyes",
      email: "rosa@reyestile.com",
    }),
  })).body?.cancel();
  const id = await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Reyes Tile", websiteUrl: GOOD }),
  });
  if (!id.ok) throw new Error(`identity seed → ${id.status}`);
  await id.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

async function post(
  http: StoryTools["http"],
  headers: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

Deno.test("REQ-1043 (q2-27): Settings refuses 'reyes tile dot com' on blur — inline error, aria-invalid, no PUT — and the customer's /i/:id keeps the previous website", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Ann Lee",
      email: "ann.lee@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      status: "sent",
      amount: 32000,
      lineItems: [{
        description: "Tile repair",
        quantity: 1,
        unit: "job",
        price: 32000,
      }],
    });

    const websitePuts: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "PUT" && req.url().includes("/profile/identity") &&
        (req.postData() ?? "").includes("websiteUrl")
      ) websitePuts.push(req.postData() ?? "");
    });

    await page.goto("/settings");
    const field = page.locator("[data-cy='settings-website']");
    const error = page.locator("[data-cy='settings-website-error']");
    await field.waitFor({ timeout: 20_000 });

    // Type and leave the field until the blur has an effect (input before hydration is a no-op):
    // either the inline error shows (fixed) or a save goes out (the bug).
    let landed = false;
    for (let attempt = 0; attempt < 10 && !landed; attempt++) {
      try {
        await field.fill(JUNK, { timeout: 2_000 });
        await field.press("Tab", { timeout: 2_000 });
      } catch {
        // not editable yet
      }
      for (let i = 0; i < 5 && !landed; i++) {
        landed = websitePuts.length > 0 ||
          await error.isVisible().catch(() => false);
        if (!landed) await page.waitForTimeout(200);
      }
    }
    await page.waitForTimeout(500);

    expect.eq(websitePuts, [], "no PUT /profile/identity carries the junk website");
    const stored = await (await http("/api/profile/identity", { headers: auth }))
      .json();
    expect.eq(stored?.websiteUrl, GOOD, "the stored website stays the previous valid one");
    expect(
      await error.isVisible().catch(() => false),
      "an inline error shows under the website field",
    );
    expect.eq(
      await field.getAttribute("aria-invalid"),
      "true",
      "the website field is aria-invalid",
    );

    // the customer's invoice never links to the junk
    await page.context().clearCookies();
    await page.goto(`/i/${inv.id}`);
    await page.locator("[data-cy='invoice-doc']").first().waitFor({
      timeout: 15_000,
    });
    const site = page.locator("[data-cy='invoice-website']");
    const href = (await site.count()) ? await site.first().getAttribute("href") : null;
    expect(
      href === null || href === GOOD,
      `the invoice's website link is the previous valid site or absent, not junk: ${href}`,
    );
  }));
