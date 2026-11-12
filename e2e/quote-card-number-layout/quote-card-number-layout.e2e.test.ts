/**
 * REQ-429 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issue p8-pair3-b: on /quotes the
 * client's initials avatar (86×86 at left 22 / top 92) painted over the quote
 * number REQ-313 had put bottom-left of the mood strip, so only a "Q" sliver
 * showed. Layout check on the real page: the number is fully visible, its box
 * does not intersect the avatar's, and nothing else paints over its centre.
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
    body: JSON.stringify({ language: "en", name: "Number Layout Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
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

Deno.test("REQ-429 (p8-pair3-b): on /quotes the quote number's box does not intersect the avatar's, and the number is not painted over", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Lena Marsh",
      email: "lena@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Deck stain — Lena Marsh",
      jobName: "Deck stain",
      description: "Stain the back deck.",
      lineItems: [{
        description: "Deck stain",
        quantity: 1,
        unit: "job",
        price: 80000,
      }],
      estimatedTotal: 80000,
      status: "draft",
    });
    expect(Boolean(quote.number), "the created quote carries a number");

    await page.goto("/quotes");
    const card = page.locator(".qcard", { hasText: "Deck stain" }).first();
    await card.waitFor({ timeout: 15_000 });
    const num = card.locator(".qcard__number");
    await num.waitFor({ timeout: 15_000 });
    expect.eq(
      (await num.textContent())?.trim(),
      quote.number,
      "the card shows the quote's number",
    );

    // elementFromPoint only sees the viewport: bring the number into it
    await num.scrollIntoViewIfNeeded();
    const res = await card.evaluate((el) => {
      const n = el.querySelector(".qcard__number") as HTMLElement;
      const a = el.querySelector(".qcard__av") as HTMLElement;
      const nr = n.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const intersects = nr.left < ar.right && ar.left < nr.right &&
        nr.top < ar.bottom && ar.top < nr.bottom;
      const cx = nr.left + nr.width / 2;
      const cy = nr.top + nr.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        intersects,
        n: [nr.left, nr.top, nr.right, nr.bottom].map(Math.round),
        a: [ar.left, ar.top, ar.right, ar.bottom].map(Math.round),
        onTop: !!hit && (hit === n || n.contains(hit) || hit.contains(n)),
        hit: hit ? hit.className : null,
      };
    });
    expect(
      !res.intersects,
      `the number ${JSON.stringify(res.n)} does not intersect the avatar ${
        JSON.stringify(res.a)
      }`,
    );
    expect(
      res.onTop,
      `nothing paints over the number (the top element at its centre is "${res.hit}")`,
    );
  }));
