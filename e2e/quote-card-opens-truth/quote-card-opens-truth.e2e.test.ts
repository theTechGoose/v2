/**
 * REQ-955 — LOOP-007 cycle 1, q1-30 [minor/BUG_CONTRADICTION] "Quote card
 * contradicts itself on opens". After one customer open, the /quotes card
 * said "OPENED 1×" / "1 open · Jose" AND "No opens recorded yet." / "Sent,
 * but no opens yet…": the timeline and the reading came from a lazily
 * fetched GET /quotes/:id/opens, and "not loaded yet" (or a failed load)
 * read as zero opens.
 *
 * The story: send a quote, open its public page once as the customer, go to
 * /quotes and read the card's text (1) unflipped — the back face is always in
 * the DOM, (2) right after the flip while the opens fetch is held, (3) after
 * the held fetch is let through, and (4) on a fresh load with the opens
 * fetch answering 500. None of them may say "no opens" while it says 1×.
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
    body: JSON.stringify({ language: "en", name: "Opens Truth Story" }),
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

const NO_OPENS = [
  "No opens recorded yet",
  "no opens yet",
  "no hay aperturas",
  "sin aperturas",
];

function saidNoOpens(text: string): string | undefined {
  return NO_OPENS.find((s) => text.includes(s));
}

Deno.test("REQ-955 (LOOP-007 q1-30): a quote opened once — its /quotes card never says 'no opens' next to 'Opened 1×' (unflipped, loading, loaded, failed load)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Jose Ramirez",
      email: "jose955@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Bathroom remodel — Jose Ramirez",
      jobName: "Bathroom remodel 955",
      description: "Retile the shower and replace the vanity.",
      lineItems: [{
        description: "Bathroom remodel",
        quantity: 1,
        unit: "job",
        price: 420000,
      }],
      estimatedTotal: 420000,
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();
    // the customer opens the link once (no session: not the owner)
    const opened = await http(`/api/quotes/${quote.id}/public`);
    await opened.body?.cancel();

    const seen: Record<string, string> = {};
    const cardSel = ".qcard:has-text('Bathroom remodel 955')";
    const card = page.locator(cardSel).first();
    const readCard = () =>
      card.evaluate((el) => (el as HTMLElement).textContent ?? "");
    const flipped = async () =>
      (await card.getAttribute("class") ?? "").includes("qcard--flipped");

    // hold every opens fetch until released
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let asked = 0;
    await page.route("**/quotes/*/opens", async (route) => {
      asked++;
      await held;
      await route.continue();
    });

    await page.goto("/quotes");
    await card.waitFor({ timeout: 15_000 });
    seen.unflipped = await readCard();
    expect(
      seen.unflipped.includes("1×"),
      `the front says it was opened once: ${seen.unflipped.slice(0, 300)}`,
    );

    await clickUntil(page, `${cardSel} .qcard__body`, flipped);
    seen.loading = await readCard();

    release();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
    seen.loaded = await readCard();
    expect(asked > 0, "the flipped card asked for its open history");

    // a fresh load where the history fails
    await page.unroute("**/quotes/*/opens");
    await page.route("**/quotes/*/opens", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "boom" }),
      }));
    await page.goto("/quotes");
    await card.waitFor({ timeout: 15_000 });
    await clickUntil(page, `${cardSel} .qcard__body`, flipped);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
    seen.failed = await readCard();

    const bad = Object.entries(seen)
      .map(([phase, text]) => [phase, saidNoOpens(text), text] as const)
      .filter(([, hit]) => hit !== undefined);
    expect.eq(
      bad.map(([phase, hit]) => `${phase}: "${hit}"`).join(", "),
      "",
      `a card that says "Opened 1×" also says no opens — ${
        bad.map(([phase, , text]) => `[${phase}] ${text.slice(0, 400)}`)
          .join(" | ")
      }`,
    );
  }));
