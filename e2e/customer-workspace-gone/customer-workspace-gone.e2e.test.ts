/**
 * REQ-993 (LOOP-007 q1, q1-75) — a customer page that went stale. Tab A sits on /customers/<id>;
 * she is deleted elsewhere (here: DELETE /api/customers/:id in the same session, as tab B would).
 * Clicking Send invoice in tab A must say she is gone — the existing "Customer not found" view
 * ([data-cy=cws-missing]) — and must NOT open a blank new-invoice form with no client chosen.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Gone Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

Deno.test("REQ-993: Send invoice on a customer page whose customer was deleted in another tab shows 'Customer not found', not a blank invoice form", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: `Ana Gone ${digits()}` }),
    });
    const ana = await r.json();
    if (!r.ok) throw new Error(`create customer → ${r.status} ${JSON.stringify(ana)}`);

    // tab A: her page, fully loaded
    await page.goto(`/customers/${ana.id}`);
    await page.locator(`[data-cy='customer-workspace'][data-customer='${ana.id}']`).waitFor({ timeout: 20_000 });
    const send = page.locator("[data-cy='cws-send-invoice']");
    await send.waitFor({ timeout: 20_000 });

    // tab B: she is deleted
    const del = await http(`/api/customers/${ana.id}`, { method: "DELETE", headers: auth });
    await del.body?.cancel();
    expect(del.ok, `the customer is deleted (${del.status})`);
    const gone = await http(`/api/customers/${ana.id}/workspace`, { headers: auth });
    await gone.body?.cancel();
    expect.eq(gone.status, 404, "her workspace now reads as not found");

    // tab A: Send invoice — wait for the customer list it re-reads, then for the UI to settle
    const listed = page.waitForResponse(
      (res) => new URL(res.url()).pathname.endsWith("/customers") && res.request().method() === "GET",
      { timeout: 15_000 },
    );
    await send.click();
    await listed;
    await page.waitForFunction(
      () =>
        !!document.querySelector("[data-cy='cws-missing']") ||
        !!document.querySelector("[data-cy='new-invoice-modal']"),
      undefined,
      { timeout: 15_000 },
    );
    const state = await page.evaluate(() => ({
      missing: !!document.querySelector("[data-cy='cws-missing']"),
      modal: !!document.querySelector("[data-cy='new-invoice-modal']"),
      client: document.querySelector("[data-cy='new-invoice-client']")?.getAttribute("data-value") ?? null,
    }));
    expect.eq(state.modal, false, `no new-invoice form opens for a deleted customer (client chosen: ${JSON.stringify(state.client)})`);
    expect.eq(state.missing, true, "the page says 'Customer not found'");
  }));
