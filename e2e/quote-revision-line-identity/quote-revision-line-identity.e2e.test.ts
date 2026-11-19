/**
 * REQ-1024 (LOOP-007 cycle 2, q2-6 + q2-42) — the tester removed the MIDDLE
 * line of the sent Q-002 (the fence repair) and repriced the painting.
 *
 *   q2-42: the owner's "Unpublished changes" summary read
 *          "Removed: Materiales … · Changed: Reparación de cerca → Materiales".
 *   q2-6:  after Publish, the customer's /q "what changed" banner said the
 *          same, while Materiales $1,350 was still listed right under it.
 *
 * Both read versionChanges, which paired lines by position. The fence must be
 * the line named as removed; Materiales must not be named at all.
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
    body: JSON.stringify({ language: "en", name: "Identity Story" }),
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

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

const line = (description: string, price: number) => ({
  description,
  quantity: 1,
  unit: "ea",
  price,
});

const PAINT = "Pintura exterior";
const FENCE = "Reparación de cerca de madera (18 pies lineales)";
const MATS = "Materiales para pintura";

Deno.test("REQ-1024 q2-42 + q2-6: removing the middle line names THAT line as removed — on the owner's Unpublished-changes summary and on the customer's /q banner", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Marta Ruiz",
      email: "marta@blackhole.postmarkapp.com",
      address: "12 Elm St, Austin, TX",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Pintura exterior — Marta Ruiz",
      jobName: "Pintura exterior",
      lineItems: [line(PAINT, 420000), line(FENCE, 90000), line(MATS, 135000)],
      estimatedTotal: 645000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    // Version 2 as a draft: the fence line goes, the painting goes up
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      lineItems: [line(PAINT, 555000), line(MATS, 135000)],
      estimatedTotal: 690000,
    });

    // q2-42 — the owner's "Unpublished changes" summary
    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-pending-badge']").waitFor({
      timeout: 15_000,
    });
    const pending = page.locator("[data-cy='quote-pending-changes']");
    await pending.waitFor({ timeout: 10_000 });
    const owner = (await pending.innerText()).replace(/\s+/g, " ").trim();
    expect.eq(
      owner,
      `Total $6,450.00 → $6,900.00 · Removed: ${FENCE} ($900.00) · Changed: ${PAINT} ($4,200.00 → $5,550.00)`,
      "the Unpublished-changes summary names the fence as removed",
    );

    // publish Version 2
    const published = await call(
      http,
      auth,
      "POST",
      `/api/quotes/${quote.id}/publish`,
      { notify: false },
    );
    expect.eq(published.version, 2, "publishing makes Version 2");

    // q2-6 — the customer's /q banner
    await page.goto(`/q/${quote.id}`);
    const changes = page.locator("[data-cy='public-doc-changes']");
    await changes.waitFor({ timeout: 15_000 });
    const banner = (await changes.innerText()).replace(/\s+/g, " ").trim();
    expect(
      new RegExp(`(Removed|Eliminado): ${FENCE.replace(/[()]/g, "\\$&")}`)
        .test(banner),
      `the /q banner names the fence as removed: "${banner}"`,
    );
    expect(
      !/Materiales/.test(banner),
      `the /q banner never names Materiales — it is still on Version 2: "${banner}"`,
    );
  }));
