/**
 * REQ-622 — demo-loop cycle 4, issue p4-p6c, on the real shell.
 *
 * The demo saw Settings ask for payment terms twice: "Days to pay an invoice: 30" in Edit details
 * and a Contract defaults "Payment terms (days)" left empty — the second one saved into a store
 * nothing reads. Here a contractor whose old card stored 45 days (and who never set "Days to pay
 * an invoice") opens Settings: the Contract defaults card is gone, and "Days to pay an invoice"
 * shows their 45 — the one setting the invoice form uses.
 */
import { story, type StoryTools } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const REFUSAL = "That file is not an image. Pick a PNG, JPG, GIF or WebP logo.";

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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
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

Deno.test("REQ-622 p4-p6c: Settings has one payment-term setting, and an old Payment terms (days) carries into it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth);
    // what the retired Contract defaults card saved
    const put = await http("/api/profile/contract-defaults", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ paymentTermsDays: 45 }),
    });
    expect(put.ok, `PUT contract-defaults (${put.status})`);
    await put.body?.cancel();

    await page.goto("/settings");
    const netDays = page.locator("[data-cy='settings-net-days']");
    await netDays.waitFor({ timeout: 15_000 });
    expect.eq(
      await netDays.inputValue(),
      "45",
      "Days to pay an invoice carries the old Payment terms (days)",
    );
    expect.eq(
      await page.locator("[data-cy='settings-contract-defaults']").count(),
      0,
      "no second payment-terms card",
    );
    expect.eq(
      await page.getByText("Payment terms (days)").count(),
      0,
      "no 'Payment terms (days)' field anywhere on Settings",
    );
    const identity =
      await (await http("/api/profile/identity", { headers: auth })).json();
    expect.eq(
      identity.invoiceNetDays,
      45,
      "the migrated value is stored on the identity",
    );
  }));
