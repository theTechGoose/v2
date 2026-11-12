/**
 * REQ-693 (demo-loop cycle 5, p18-7a) — "Discard draft" on /quotes asks
 * first: one click shows "Discard Version 2? Your edits are lost." with
 * Discard / Keep; Keep leaves the draft revision alone, Discard drops it.
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
    body: JSON.stringify({ language: "en", name: "Revise Story" }),
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

Deno.test("REQ-693: Discard draft asks 'Discard Version 2? Your edits are lost.' — Keep keeps the revision, Discard drops it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Marta Ruiz",
      email: "marta@blackhole.postmarkapp.com",
      address: "4 Elm St, Austin, TX",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Kitchen refresh — Marta Ruiz",
      jobName: "Kitchen Refresh",
      lineItems: [line("New Cabinets & Countertops", 1850000)],
      estimatedTotal: 1850000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    const pendingOf = async () =>
      (await call(http, auth, "GET", `/api/quotes/${quote.id}`))
        .pendingRevision;

    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-edit']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='quote-edit']").click();
    await page.locator("[data-cy='quote-edit-add-line']").click();
    await page.getByRole("textbox", { name: "Description 2" }).fill(
      "Tile backsplash",
    );
    await page.getByRole("spinbutton", { name: "Price ($) 2" }).fill("700");
    await page.locator("[data-cy='quote-edit-save']").click();
    await page.locator("[data-cy='quote-pending-badge']").waitFor({
      timeout: 15_000,
    });

    // one click only asks — nothing is thrown away yet
    await page.locator("[data-cy='quote-discard-draft']").click();
    const ask = page.locator("[data-cy='quote-discard-ask']");
    await ask.waitFor({ timeout: 10_000 });
    expect.eq(
      (await ask.innerText()).trim(),
      "Discard Version 2? Your edits are lost.",
      "the ask names the version and says the edits are lost",
    );
    expect.eq(
      (await pendingOf()) !== undefined,
      true,
      "the first click does not discard the revision",
    );

    // Keep → back to the draft, revision intact
    await page.locator("[data-cy='quote-discard-keep']").click();
    await ask.waitFor({ state: "detached", timeout: 10_000 });
    expect.eq(
      await page.locator("[data-cy='quote-pending-badge']").count(),
      1,
      "Keep leaves the draft revision pending",
    );
    expect.eq((await pendingOf()) !== undefined, true, "Keep discards nothing");

    // Discard → the revision is gone
    await page.locator("[data-cy='quote-discard-draft']").click();
    await page.locator("[data-cy='quote-discard-confirm']").click();
    await page.locator("[data-cy='quote-pending-badge']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    expect.eq(await pendingOf(), undefined, "Discard drops the revision");
  }));
