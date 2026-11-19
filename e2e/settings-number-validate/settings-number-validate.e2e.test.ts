/**
 * REQ-978 (LOOP-007 cycle 1, q1-58) — "test every single aspect of this application". Settings →
 * Edit your details says changes are saved instantly, yet an out-of-range number was put back
 * silently on blur: -5 days to pay snapped back to 45, 500 in % overhead became the stored value
 * (0 after a reload), a negative chargeback fee snapped back — no message, nothing saved. In a
 * browser: each bad blur shows an inline error under its field, keeps the typed value on screen,
 * and the stored value stays.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      language: "en",
      name: "Carl Jensen",
      email: "carl@jensen.com",
    }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Jensen Roofing",
      invoiceNetDays: 45,
      fieldOverheadMode: "percent",
      fieldOverheadPct: 10,
      chargebackFeeCents: 3500,
    }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

/**
 * Type a value and leave the field until the island has reacted to the blur: either the inline
 * error shows (the fix) or the value on screen changed away from what was typed (the q1-58 silent
 * revert). Input before hydration is a no-op, so this retries.
 */
async function fillAndBlur(
  page: StoryTools["page"],
  field: string,
  errorSel: string,
  value: string,
): Promise<void> {
  const reacted = async () =>
    (await page.locator(errorSel).isVisible().catch(() => false)) ||
    (await page.locator(field).inputValue().catch(() => value)) !== value;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await page.locator(field).fill(value, { timeout: 2_000 });
      await page.locator(field).press("Tab", { timeout: 2_000 });
    } catch {
      // not editable yet: the polls below say whether the blur landed
    }
    for (let i = 0; i < 5; i++) {
      if (await reacted()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${field}: the blur never took`);
}

async function expectRefused(
  { page, expect }: Pick<StoryTools, "page" | "expect">,
  field: string,
  errorSel: string,
  typed: string,
  what: string,
): Promise<void> {
  await fillAndBlur(page, field, errorSel, typed);
  // the q1-58 bug: the old value comes back with no message
  expect.eq(
    await page.locator(field).inputValue(),
    typed,
    `${what}: the typed value stays on screen (not silently put back)`,
  );
  expect(
    await page.locator(errorSel).isVisible().catch(() => false),
    `${what}: an inline error shows under the field (${errorSel})`,
  );
  expect.eq(
    await page.locator(field).getAttribute("aria-invalid"),
    "true",
    `${what}: the field is aria-invalid`,
  );
  expect(
    ((await page.locator(errorSel).innerText().catch(() => "")) ?? "").trim()
      .length > 0,
    `${what}: the error has a message`,
  );
}

Deno.test("REQ-978 q1-58: Settings refuses -5 days to pay, 500 % overhead and a negative chargeback fee with an inline error — the typed value stays, nothing saved", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.goto("/settings");
    await page.locator("[data-cy='settings-net-days']").waitFor({
      timeout: 20_000,
    });

    await expectRefused(
      { page, expect },
      "[data-cy='settings-net-days']",
      "[data-cy='settings-net-days-error']",
      "-5",
      "days to pay -5",
    );
    await expectRefused(
      { page, expect },
      "[data-cy='settings-overhead']",
      "[data-cy='settings-overhead-error']",
      "500",
      "overhead 500 %",
    );
    await expectRefused(
      { page, expect },
      "[data-cy='settings-chargeback-fee']",
      "[data-cy='settings-chargeback-fee-error']",
      "-1",
      "chargeback fee -1",
    );

    // nothing reached the server
    await page.waitForTimeout(500);
    const id = await (await http("/api/profile/identity", { headers: auth }))
      .json();
    expect.eq(id.invoiceNetDays, 45, "stored days to pay unchanged");
    expect.eq(id.fieldOverheadPct, 10, "stored overhead % unchanged");
    expect.eq(id.chargebackFeeCents, 3500, "stored chargeback fee unchanged");

    // a good value clears the error and saves
    await page.locator("[data-cy='settings-net-days']").fill("30");
    await page.locator("[data-cy='settings-net-days']").press("Tab");
    let stored = 0;
    for (let i = 0; i < 25 && stored !== 30; i++) {
      await page.waitForTimeout(200);
      stored = (await (await http("/api/profile/identity", { headers: auth }))
        .json()).invoiceNetDays;
    }
    expect.eq(stored, 30, "a valid days to pay saves");
    expect.eq(
      await page.locator("[data-cy='settings-net-days-error']").count(),
      0,
      "the error is gone after a valid value",
    );
  }));
