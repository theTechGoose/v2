/**
 * REQ-364 — demo issue p15-16 (demo-loop cycle 1, pair 8): "Today's loop: 1 friendly check-in …
 * for a guy I added 2 min ago". The loop strip on /customers (islands/ClientsPage.tsx → LoopBar,
 * fed by GET /api/clients `loop`) must not offer a check-in for a lead made minutes ago.
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
    body: JSON.stringify({ language: "en", name: "Loop Story" }),
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

Deno.test("REQ-364: a lead added a minute ago is not offered as a check-in in Today's loop", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const c = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Guy Justadded",
        email: "guy@blackhole.postmarkapp.com",
      }),
    })).json();
    const q = await http("/api/quotes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: c.id,
        summary: "Fence repair",
        lineItems: [],
      }),
    });
    await q.body?.cancel();
    await page.goto("/customers");
    await expect.see("Guy Justadded");
    const bar = page.locator(".loopbar").first();
    await bar.waitFor();
    const text = await bar.innerText();
    expect(/today.s loop/i.test(text), `the strip is there (${text})`);
    expect(
      !/friendly check-in/i.test(text),
      `no check-in is offered for a lead made a minute ago (${text})`,
    );
    expect(
      /no check-ins drafted yet/i.test(text),
      `the strip says there is nothing to check in on (${text})`,
    );
  }));
