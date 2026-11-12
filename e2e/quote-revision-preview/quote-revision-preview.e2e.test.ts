/**
 * REQ-466 (demo-loop cycle 3, m38) — Version 2 can be reviewed before
 * Publish: with a draft revision pending, the open quote shows what it
 * changes next to "Unpublished changes", and "View draft" lists the draft's
 * line items — without opening the publish confirm.
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
    body: JSON.stringify({ language: "en", name: "Preview Story" }),
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

Deno.test("REQ-466 m38: a pending revision shows its change line and its draft lines before Publish", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Dana Lee",
      email: "dana@blackhole.postmarkapp.com",
      address: "9 Oak St, Austin, TX",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Bathroom remodel — Dana Lee",
      jobName: "Bathroom Remodel",
      lineItems: [
        line("Demo old tile", 345000),
        line("Tile shower walls", 320000),
      ],
      estimatedTotal: 665000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    // Version 2 as a draft: the shower walls go up $400
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      lineItems: [
        line("Demo old tile", 345000),
        line("Tile shower walls", 360000),
      ],
      estimatedTotal: 705000,
    });
    const pending = (await call(http, auth, "GET", `/api/quotes/${quote.id}`))
      .pendingRevision;
    expect.eq(
      Boolean(pending?.lineItems),
      true,
      "the edit is a pending revision",
    );

    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-pending-badge']").waitFor({
      timeout: 15_000,
    });

    // the change line sits with the badge — no confirm opened
    const changes = page.locator("[data-cy='quote-pending-changes']");
    await changes.waitFor({ timeout: 10_000 });
    expect.eq(
      (await changes.innerText()).trim(),
      "Total $6,650.00 → $7,050.00 · Changed: Tile shower walls ($3,200.00 → $3,600.00)",
      "the pending change is named next to the badge",
    );
    expect.eq(
      await page.locator("[data-cy='quote-publish-preview']").count(),
      0,
      "the publish confirm is not open",
    );

    // View draft lists the draft's line items
    expect.eq(
      await page.locator("[data-cy='quote-draft-lines']").count(),
      0,
      "the draft list starts closed",
    );
    await page.locator("[data-cy='quote-view-draft']").click();
    const lines = page.locator("[data-cy='quote-draft-line']");
    await lines.first().waitFor({ timeout: 10_000 });
    expect.eq(
      (await lines.allInnerTexts())
        .map((s) => s.replace(/\s+/g, " ").trim())
        .join(" | "),
      "Demo old tile $3,450.00 | Tile shower walls $3,600.00",
      "View draft lists the draft's lines",
    );
    expect.eq(
      (await page.locator("[data-cy='quote-draft-total']").innerText())
        .replace(/\s+/g, " ").trim(),
      "Draft total $7,050.00",
      "View draft shows the draft total",
    );
    await page.locator("[data-cy='quote-view-draft']").click();
    await page.locator("[data-cy='quote-draft-lines']").waitFor({
      state: "detached",
      timeout: 5_000,
    });
  }));
