/**
 * REQ-197 — the server renders /worker in its final state: a signed-in worker's HTML already
 * carries the greeting and the day's visit; an anonymous request's HTML already carries the login
 * form; neither carries the "Loading…" placeholder.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"]) {
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
  return { ...JSON_HEADERS, cookie };
}

Deno.test("REQ-197: /worker arrives from the server already signed in (or already the login form) — no Loading… first paint", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http);
    const cell = `843555${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const w = await (await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Luis Server",
        phoneNumber: cell,
        pin: "1234",
      }),
    })).json();
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Torres",
        phoneNumber: "(843) 555-0171",
        email: "ana@blackhole.postmarkapp.com",
      }),
    })).json();
    const today = new Date();
    const iso = `${today.getFullYear()}-${
      String(today.getMonth() + 1).padStart(2, "0")
    }-${String(today.getDate()).padStart(2, "0")}`;
    const sub = await (await http("/api/field/subscriptions", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        address: "4601 Dick Pond Rd",
        startDate: iso,
        items: [{ taskTypeName: "Mowing", priceCents: 6500 }],
      }),
    })).json();
    await (await http(`/api/field/regions/${sub.region.id}/worker`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ workerId: w.id }),
    })).body?.cancel();

    // anonymous: the HTML is the login form, not the placeholder
    const anon = await (await http("/worker?lang=en")).text();
    expect(
      anon.includes('data-cy="w-cell"'),
      "an anonymous request gets the login form from the server",
    );
    expect(
      !anon.includes("Loading…"),
      "no Loading… placeholder for an anonymous request",
    );

    // the worker signs in; from then on the server renders the signed-in screen
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.locator("[data-cy='w-visit']").waitFor({ timeout: 15_000 });
    const html = await (await page.context().request.get(
      `${baseUrl}/worker?lang=en&date=${iso}`,
    )).text();
    expect(
      html.includes("Luis Server"),
      "the signed-in worker's HTML carries the greeting",
    );
    expect(
      html.includes("Ana Torres"),
      "the signed-in worker's HTML carries the day's visit",
    );
    expect(
      html.includes('data-cy="w-summary"'),
      "the summary card is in the HTML",
    );
    expect(
      !html.includes("Loading…"),
      "no Loading… placeholder for a signed-in worker",
    );
    expect(
      !html.includes('data-cy="w-cell"'),
      "no login form for a signed-in worker",
    );

    // and the page is still live after hydration: a check-off works and the ring moves
    await page.goto(`/worker?lang=en&date=${iso}`);
    await page.locator("[data-cy='w-check']").first().click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='w-progress']")?.getAttribute(
          "aria-valuenow",
        ) === "1",
      undefined,
      { timeout: 15_000 },
    );
  }));
