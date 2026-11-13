/**
 * REQ-395 (demo-loop cycle 2, M12 + m24 + m27 + p13-i) — the revision editor
 * on /quotes in a browser:
 *
 *  - p13-i: every editor input is labelled ("Description 1", "Qty 1", …);
 *  - m24: the publish preview names the line it adds ("Added: Tile
 *    backsplash ($700.00)") instead of "1 line added";
 *  - M12: an unwanted draft revision has "Discard draft", and an edit saved
 *    back to the published version leaves no "Unpublished changes";
 *  - m27: after publishing, the "Saved as unpublished Version 2" line is gone.
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

Deno.test("REQ-395: the revision editor is labelled, the preview names the added line, a draft revision can be discarded or edited away, and publishing clears the 'saved' line", (t) =>
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

    async function addBacksplash() {
      await page.locator("[data-cy='quote-edit']").click();
      await page.locator("[data-cy='quote-edit-add-line']").click();
      // p13-i: the second row's inputs are found by their labels
      await page.getByRole("textbox", { name: "Description 2" }).fill(
        "Tile backsplash",
      );
      await page.getByRole("spinbutton", { name: "Price ($) 2" }).fill("700");
      await page.locator("[data-cy='quote-edit-save']").click();
      await page.locator("[data-cy='quote-pending-badge']").waitFor({
        timeout: 15_000,
      });
    }

    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-edit']").waitFor({ timeout: 15_000 });

    // p13-i: labelled inputs with placeholders
    await page.locator("[data-cy='quote-edit']").click();
    const desc1 = page.getByRole("textbox", { name: "Description 1" });
    await desc1.waitFor({ timeout: 10_000 });
    expect.eq(
      await desc1.inputValue(),
      "New Cabinets & Countertops",
      "the first description input is labelled 'Description 1'",
    );
    expect.eq(
      await page.getByRole("spinbutton", { name: "Qty 1" }).count(),
      1,
      "the quantity input is labelled 'Qty 1'",
    );
    expect.eq(
      await desc1.getAttribute("placeholder"),
      "Line description",
      "the description input has a placeholder",
    );
    await page.locator("[data-cy='quote-edit-cancel']").click();

    // m24: the preview names the added line
    await addBacksplash();
    await page.locator("[data-cy='quote-publish']").click();
    const changes = page.locator("[data-cy='quote-publish-changes']");
    await changes.waitFor({ timeout: 10_000 });
    expect.eq(
      (await changes.innerText()).trim(),
      "Total $18,500.00 → $19,200.00 · Added: Tile backsplash ($700.00)",
      "the publish preview names the line",
    );
    await page.locator("[data-cy='quote-publish-cancel']").click();

    // M12: Discard draft drops it; the customer's version is untouched
    await page.locator("[data-cy='quote-discard-draft']").click();
    // REQ-693: the discard asks first
    await page.locator("[data-cy='quote-discard-confirm']").click();
    await page.locator("[data-cy='quote-pending-badge']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    expect.eq(await pendingOf(), undefined, "the draft revision is gone");
    expect.eq(
      await page.locator("[data-cy='quote-publish']").count(),
      0,
      "nothing to publish after a discard",
    );
    expect.eq(
      await page.locator("[data-cy='quote-edit-saved']").count(),
      0,
      "no 'saved as unpublished' line after a discard",
    );

    // M12: an edit saved back to the published version is no revision
    await addBacksplash();
    await page.locator("[data-cy='quote-edit']").click();
    await page.locator("[data-cy='quote-edit-line-remove-1']").click();
    await page.locator("[data-cy='quote-edit-save']").click();
    await page.locator("[data-cy='quote-pending-badge']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    expect.eq(await pendingOf(), undefined, "V3 == V2 leaves nothing pending");
    expect.eq(
      await page.locator("[data-cy='quote-edit-saved']").count(),
      0,
      "no 'saved as unpublished' line when nothing waits",
    );

    // m27: publish → the saved line goes, 'Revision published' stays
    await addBacksplash();
    await page.locator("[data-cy='quote-edit-saved']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='quote-publish']").click();
    await page.locator("[data-cy='quote-publish-confirm']").click();
    await page.locator("[data-cy='quote-published-note']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='quote-edit-saved']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    const published = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(published.version, 2, "publishing makes Version 2");
    expect.eq(published.lineItems.length, 2, "Version 2 has the backsplash");
  }));
