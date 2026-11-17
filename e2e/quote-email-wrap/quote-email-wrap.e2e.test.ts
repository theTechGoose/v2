/**
 * REQ-328 — demo-loop cycle 1, demo issue p10: "Business email wraps mid-word
 * on /q/" (pair 9: "rosa@delgadojunk.exampl|e!"). The contact footer's
 * mailto anchor had `word-break:break-all`, so the address split at whatever
 * character hit the line end even though it fit whole on the next line.
 *
 * In a browser: a sent quote whose contractor email is the demo's address;
 * at 390, 768 and 1280 px the anchor paints on ONE line (one client rect)
 * and never past the card's right edge. A second story keeps P-58's guard:
 * an address too long for the 390 px text column may split, but never
 * paints past the card edge.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const EMAIL = "rosa@delgadojunk.example";
const LONG_EMAIL = "rosa.delgado.hernandez@delgadojunkremovalaustin.example";

async function signIn(http: StoryTools["http"], email = EMAIL) {
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
    body: JSON.stringify({
      language: "en",
      name: "Rosa Delgado",
      email,
    }),
  });
  await me.body?.cancel();
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

async function sentQuote(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<string> {
  const customer = await post(http, auth, "/api/customers", {
    name: "Ana Pérez",
    email: "ana@blackhole.postmarkapp.com",
  });
  const quote = await post(http, auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Junk removal",
    jobName: "Junk removal",
    lineItems: [{
      description: "Junk removal",
      quantity: 1,
      unit: "job",
      price: 48000,
    }],
    estimatedTotal: 48000,
    status: "draft",
  });
  const sent = await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ status: "sent" }),
  });
  await sent.body?.cancel();
  return quote.id as string;
}

/** the footer anchor's line boxes and the card's right edge */
function measure(a: HTMLElement) {
  const card = a.closest("article") ?? a.closest("footer")!;
  const rects = Array.from(a.getClientRects() as DOMRectList).map(
    (
      r: DOMRect,
    ) => [Math.round(r.left), Math.round(r.right), Math.round(r.top)],
  );
  return {
    lines: rects.length,
    rects,
    right: Math.max(...rects.map((r) => r[1])),
    cardRight: Math.round(card.getBoundingClientRect().right),
  };
}

Deno.test("REQ-328 p10: the /q contractor email paints on one line at 390/768/1280px and never past the card edge", (t) =>
  story(t, async ({ page, expect, http }) => {
    const { auth } = await signIn(http);
    const id = await sentQuote(http, auth);
    await page.goto(`/q/${id}?lang=en`);
    const anchor = page.locator(`footer a[href="mailto:${EMAIL}"]`);
    await anchor.waitFor({ timeout: 15_000 });

    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const m = await anchor.evaluate(measure);
      expect.eq(
        m.lines,
        1,
        `${width}px: the email paints on one line, not split mid-word (rects ${
          JSON.stringify(m.rects)
        })`,
      );
      expect(
        m.right <= m.cardRight,
        `${width}px: the email stays inside the card (${m.right} <= ${m.cardRight})`,
      );
    }
  }));

Deno.test("REQ-328 p10 (P-58 kept): an address too long for the 390px column may split, but never paints past the card edge", (t) =>
  story(t, async ({ page, expect, http }) => {
    const { auth } = await signIn(http, LONG_EMAIL);
    const id = await sentQuote(http, auth);
    await page.goto(`/q/${id}?lang=en`);
    const anchor = page.locator(`footer a[href="mailto:${LONG_EMAIL}"]`);
    await anchor.waitFor({ timeout: 15_000 });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(150);
    const m = await anchor.evaluate(measure);
    expect(
      m.right <= m.cardRight,
      `390px: the long email stays inside the card (${m.right} <= ${m.cardRight}, rects ${
        JSON.stringify(m.rects)
      })`,
    );
  }));
