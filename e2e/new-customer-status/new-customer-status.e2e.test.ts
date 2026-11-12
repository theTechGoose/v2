/**
 * REQ-271 — demo issue i18n-formatting-m5: "Brand-new customer labelled 'HABITUAL' / 'Regular'".
 * A customer added a minute ago, with no quote and no invoice, is "Cliente nuevo" on /customers —
 * never "Habitual" — and the board's "Nuevos" chip finds it.
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
    body: JSON.stringify({ language: "es", name: "New Customer Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "es",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

Deno.test("REQ-271: a customer just added shows as Cliente nuevo, never Habitual, and the Nuevos chip finds it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Recién",
        email: "ana@blackhole.postmarkapp.com",
      }),
    });
    await r.body?.cancel();
    await page.goto("/customers");
    await expect.see("Ana Recién");
    const card = page.locator(".ccard2").first();
    await card.waitFor();
    const text = (await card.innerText()).toLowerCase();
    expect(
      text.includes("cliente nuevo"),
      `the card says Cliente nuevo (${text})`,
    );
    expect(
      !text.includes("habitual"),
      `the card never says Habitual (${text})`,
    );
    await expect.see("Nuevos");
  }));
