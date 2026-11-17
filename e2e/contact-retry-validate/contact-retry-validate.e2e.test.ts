/**
 * REQ-603 — demo-loop cycle 4, issue M23: "Raw 'PUT /customers/<id> failed:
 * 400' in chat; letter silently dropped from number". In the chat's recovery
 * box ("Fix the number and resend") a typed "512-867-53O9" showed as
 * "(512) 867-539" — the letter vanished — Save stayed enabled, and the
 * backend's 400 was printed in the chat as lib/api's transport line.
 *
 * Now the letter stays visible and is flagged under the box, a short number
 * asks for all 10 digits, and Save stays disabled until the number is whole.
 * The recovery box is reached as in e2e/sms-recovery (a quote texted to a
 * fictional 555-01XX number). Page: /assistant/[id] (islands/AsstChat.tsx).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Sms User", language: lang }],
      ["/api/profile/identity", { businessName: "Sms Business" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: lang, domain: host, path: "/" },
  ]);
  return auth;
}

/** A quote for a customer with a fictional phone, texted from a conversation;
 *  returns the conversation id. */
async function sendToFictionalPhone(
  http: StoryTools["http"],
  auth: Record<string, string>,
  lang: "en" | "es",
): Promise<string> {
  const post = async (path: string, payload?: unknown) => {
    const res = await http(path, {
      method: "POST",
      headers: auth,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return await res.json().catch(() => ({}));
  };
  const customer = await post("/api/customers", {
    name: "Dana Fictional",
    phoneNumber: "(512) 555-0123",
  });
  const quote = await post("/api/quotes", {
    summary: "Fence repair",
    lineItems: [{
      description: "Fence repair",
      quantity: 1,
      unit: "ea",
      price: 50000,
    }],
    estimatedTotal: 50000,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await post("/api/agents/conversations", {
    quoteId: quote.id,
    customerId: customer.id,
  });
  await post(`/api/agents/conversations/${conv.id}/send-quote`, {
    quoteId: quote.id,
    channel: "sms",
    language: lang,
  });
  return conv.id as string;
}

for (
  const [lang, letters, digits] of [
    ["en", /digits only/i, /10 digits/i],
    ["es", /solo dígitos/i, /10 dígitos/i],
  ] as const
) {
  Deno.test(`REQ-603 (${lang}): the recovery box keeps a typed letter visible, flags it, and won't save a short number`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const auth = await signIn(http, page, baseUrl, lang);
      const conversationId = await sendToFictionalPhone(http, auth, lang);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/assistant/${conversationId}`);
      const card = page.locator(".recovery-card").first();
      await card.waitFor({ state: "visible", timeout: 20_000 });
      const input = card.locator("input[type=tel]");
      const save = card.locator(".recovery-card__save");
      const err = card.locator("[data-cy='recovery-phone-error']");

      await input.fill("512-867-53O9");
      await err.waitFor({ state: "visible", timeout: 15_000 });
      const shown = await input.inputValue();
      expect(/O/.test(shown), `the typed letter stays visible: "${shown}"`);
      const e1 = (await err.innerText()).trim();
      expect(letters.test(e1), `the letter is flagged: "${e1}"`);
      expect(await save.isDisabled(), "Save is disabled on a letter");
      expect(
        (await input.getAttribute("aria-invalid")) === "true",
        "the box is aria-invalid",
      );

      await input.fill("512-867-539");
      await page.waitForFunction(
        (re) =>
          new RegExp(re, "i").test(
            document.querySelector("[data-cy='recovery-phone-error']")
              ?.textContent ?? "",
          ),
        digits.source,
        { timeout: 15_000 },
      );
      expect(await save.isDisabled(), "Save is disabled on 9 digits");

      await input.fill("5128675309");
      await err.waitFor({ state: "detached", timeout: 15_000 });
      expect(!(await save.isDisabled()), "a full number enables Save");

      const text = await page.locator("body").innerText();
      expect(!/failed: \d{3}/.test(text), "no transport line on screen");
      expect(!/PUT \/customers/.test(text), "no request line on screen");
    }));
}
