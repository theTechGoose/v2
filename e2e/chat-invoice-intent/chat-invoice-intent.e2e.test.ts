/**
 * REQ-656 (demo-loop cycle 5, run r37f88707, M9) on the real app — pair 8:
 * in a new assistant chat the contractor types the starter chip's own words,
 * "Trabajo terminado, necesito facturar: Jorge Ruiz, jorge.ruiz@example.com,
 * sacamos un refrigerador y una lavadora viejos, $200. Que pague hoy."
 *
 * The demo's chat drafted "Q-002 · Cotización redactada". Now the reply
 * says it started the invoice for Jorge Ruiz, $200, and the chat opens the
 * chip's invoice flow at its price step, the pad already at $200, and no
 * quote is drafted.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx; the reply from
 * backend/src/agents/domain/coordinators/handle-chat-message, the offer rule
 * from shared/quote-flow/chat-invoice-flow-offer.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SAID =
  "Trabajo terminado, necesito facturar: Jorge Ruiz, jorge.ruiz@example.com, sacamos un refrigerador y una lavadora viejos, $200. Que pague hoy.";

/** Signed in, past onboarding, in Spanish. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  await answerQuestions(http, auth, {
    name: "Rosa Delgado",
    businessName: "Delgado Hauling",
  });
  const lang = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es" }),
  });
  await lang.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "es", domain: host, path: "/" },
  ]);
  return auth;
}

/** Type the line and send it once the island is live (a keypress before
 *  hydration is lost); never twice. */
async function say(page: StoryTools["page"], text: string) {
  const box = page.locator(".composer textarea.composer__input");
  const mine = page.locator(".msg.msg--user", { hasText: text });
  const pad = page.locator(".chat__price-capture");
  await box.waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await mine.count() > 0 || await pad.count() > 0) return;
    await box.fill(text);
    await box.press("Enter");
    for (let i = 0; i < 4; i++) {
      if (await mine.count() > 0 || await pad.count() > 0) return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`"${text}" was never sent`);
}

Deno.test("REQ-656 M9: pair 8 — 'Trabajo terminado, necesito facturar: Jorge Ruiz … $200' typed opens the invoice flow at $200; no quote is drafted", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await say(page, SAID);

    const money = page.locator(".chat__price-capture input.mi__input");
    await money.waitFor({ state: "visible", timeout: 30_000 });
    await money.hover(); // the pad, on screen, in the evidence
    expect.eq(
      (await money.inputValue()).trim(),
      "200",
      "the invoice flow's pad opens at the typed $200",
    );
    const recap = await page.locator(".chat__price-details-recap-text")
      .innerText();
    expect(
      recap.includes("Jorge Ruiz"),
      `the flow carries the job details (got: ${recap})`,
    );
    expect.eq(
      await page.locator(".action-card").count(),
      0,
      "no quote card was drafted",
    );
    const quotes = await (await http("/api/quotes", { headers: auth }))
      .json() as { isSample?: boolean }[];
    expect.eq(
      quotes.filter((q) => !q.isSample).length,
      0,
      "no quote exists",
    );
    // the thread keeps the reply, and its offer
    const convoId = new URL(page.url()).pathname.split("/").pop() ?? "";
    const detail = await (await http(`/api/agents/conversations/${convoId}`, {
      headers: auth,
    })).json() as {
      messages?: { role: string; content: string; payload?: unknown }[];
    };
    const reply = (detail.messages ?? []).find((m) =>
      m.role === "assistant" &&
      (m.payload as { invoiceFlow?: unknown } | undefined)?.invoiceFlow
    );
    expect(!!reply, "the reply carries the invoice flow");
    expect(
      !!reply && reply.content.includes("Jorge Ruiz") &&
        reply.content.includes("$200"),
      `the reply names who and how much (got: ${reply?.content})`,
    );
  }));
