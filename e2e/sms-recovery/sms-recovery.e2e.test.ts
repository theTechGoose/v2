/**
 * REQ-226 — "fix every issue the demo found". Demo issues
 * quote-invoice-money-m4, test-setup-claims-555-copy and
 * customers-payments-fieldops-m1: a contractor texted a quote to a customer
 * whose phone was on file but could not take texts (a 555-01XX number), and
 * the assistant said "Add their phone to deliver" — under a divider reading
 * "(Twilio would reject it: 21211)".
 *
 * Here the customer HAS a phone (a fictional 555-01XX number, which the send
 * path refuses before any provider is called — the same on the gate's fakes
 * and on a pin). The recovery card must ask to CHECK that number, with it
 * pre-filled, and nothing on screen names Twilio or 21211.
 *
 * Page: /assistant/[id] (island front-end/islands/AsstChat.tsx; the decision
 * in shared/quote-flow/sms-failure.ts).
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
  const [lang, headline] of [
    // REQ-525 (cycle 3, p8-pair2-a): the headline is the action to take —
    // the reason itself is the send card's to tell, not a third time here.
    ["en", /^Fix the number and resend$/],
    ["es", /^Corrige el número y vuelve a enviar$/],
  ] as const
) {
  Deno.test(`REQ-226 (${lang}): a phone on file that can't take texts → the card asks to check it, pre-filled, and no Twilio/21211 on screen`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const auth = await signIn(http, page, baseUrl, lang);
      const conversationId = await sendToFictionalPhone(http, auth, lang);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/assistant/${conversationId}`);
      const card = page.locator(".recovery-card").first();
      await card.waitFor({ state: "visible", timeout: 20_000 });
      const head = (await card.locator(".recovery-card__head strong")
        .innerText()).trim();
      expect(
        headline.test(head),
        `the card asks to check the number: "${head}"`,
      );
      expect(
        !/add their phone|agrega su tel/i.test(head),
        `the card never says "add their phone": "${head}"`,
      );
      const input = await card.locator("input[type=tel]").inputValue();
      expect(
        input.replace(/\D/g, "").endsWith("5125550123"),
        `the number on file is pre-filled: "${input}"`,
      );
      const text = await page.locator(".asst, body").first().innerText();
      expect(!/twilio/i.test(text), "no provider name on screen");
      expect(!/21211/.test(text), "no provider error code on screen");
    }));
}

// REQ-525 — demo-loop cycle 3, issue p8-pair2-a: "The same 555 send error is
// shown three times". The divider above the recovery box now reads only
// "Text not delivered" — it no longer restates the 555 reason the send card
// owns — and the recovery box names the fix, not the failure.
for (
  const [lang, divider, reason] of [
    ["en", "Text not delivered", /reserved test number/i], // REQ-523 wording
    ["es", "Mensaje de texto no entregado", /número de prueba reservado/i], // REQ-523 wording
  ] as const
) {
  Deno.test(`REQ-525 (${lang}): a failed text's divider is short and the recovery box doesn't repeat the reason`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const auth = await signIn(http, page, baseUrl, lang);
      const conversationId = await sendToFictionalPhone(http, auth, lang);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/assistant/${conversationId}`);
      const card = page.locator(".recovery-card").first();
      await card.waitFor({ state: "visible", timeout: 20_000 });
      const label = (await page.locator(".phase-divider__label").last()
        .innerText()).trim();
      expect(label === divider, `divider reads "${divider}": "${label}"`);
      expect(!reason.test(label), `divider restates the reason: "${label}"`);
      const head = (await card.locator(".recovery-card__head").innerText())
        .trim();
      expect(!reason.test(head), `recovery box restates the reason: "${head}"`);
    }));
}
