/**
 * REQ-239 (demo issue M28) — a sent quote's card on /quotes ("Out for
 * response") opens the quote panel: flip the card, press Open, and the
 * REQ-201/205 panel shows with ?open=<id> in the address bar. Before the fix
 * the card had no Open action at all; only typing ?open=<id> reached it.
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Open Card Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

/** an island may still be hydrating when its target appears: click until the page shows the effect */
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

Deno.test("REQ-239 (M28): a sent quote's card on /quotes opens the quote panel — flip, Open, the panel and ?open=<id>", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Opal Card",
      email: "opal@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Fence repair — Opal Card",
      jobName: "Fence repair",
      description: "Replace three fence panels.",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 50000,
      }],
      estimatedTotal: 50000,
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();

    await page.goto("/quotes");
    const card = page.locator(".qcard", { hasText: "Fence repair" });
    await card.first().waitFor({ timeout: 15_000 });
    const panel = page.locator("[data-cy='quote-open-panel']");
    expect.eq(await panel.count(), 0, "no panel before the card is opened");

    // flip the card to its back
    await clickUntil(
      page,
      ".qcard:has-text('Fence repair') .qcard__body",
      async () =>
        (await card.first().getAttribute("class") ?? "").includes(
          "qcard--flipped",
        ),
    );
    // press Open on the back
    await clickUntil(
      page,
      ".qcard:has-text('Fence repair') [data-cy='qcard-open']",
      async () => (await panel.count()) > 0,
    );
    await panel.waitFor({ timeout: 15_000 });
    await expect.see("Fence repair");
    expect(
      page.url().includes(`open=${quote.id}`),
      "the address bar carries ?open=<id>",
    );
  }));
