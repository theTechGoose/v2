/**
 * REQ-246 — demo issue quote-invoice-money-m7: "'Edit' on the draft action
 * card does nothing visible." (fleet-0: "Clicked Edit — nothing opened".)
 *
 * The draft quote card's Edit button used to be `setDraft("")` — it cleared
 * the composer and nothing else. Now Edit puts the edit prompt in the
 * composer, focuses it with the caret at the end, and keeps anything already
 * typed.
 *
 * A draft action_card only comes out of the LLM's create_quote, so the story
 * opens a real conversation through /assistant?c=<id> (which loads the thread
 * client-side) and answers that one load with the conversation plus a draft
 * quote card.
 *
 * Page: front-end/routes/assistant/index.tsx (island
 * front-end/islands/AsstChat.tsx).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  await answerQuestions(http, auth, {
    name: "Edit User",
    businessName: "Edit Business",
  });
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

Deno.test("REQ-246: Edit on the draft quote card opens the composer with the edit prompt", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const res = await http("/api/agents/conversations", {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    const conversation = await res.json();
    const id = conversation.id as string;
    const now = Date.now();
    await page.route(
      `**/api/agents/conversations/${id}`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            conversation,
            messages: [
              {
                id: "m-user",
                conversationId: id,
                role: "user",
                kind: "text",
                content: "Quote a bathroom tile job, $1,200",
                createdAt: now - 2000,
              },
              {
                id: "m-card",
                conversationId: id,
                role: "assistant",
                kind: "action_card",
                content: "Quote drafted",
                createdAt: now - 1000,
                payload: {
                  actionType: "quote",
                  status: "draft",
                  quoteId: "q-req246",
                  lineItems: [
                    { description: "Tile install", amountCents: 100000 },
                    { description: "Materials", amountCents: 20000 },
                  ],
                  totalCents: 120000,
                },
              },
            ],
          }),
        }),
    );

    await page.goto(`/assistant?c=${id}`);
    const card = page.locator(".action-card", { hasText: "Tile install" });
    await card.waitFor({ state: "visible" });
    const composer = page.locator("textarea.composer__input");
    await composer.waitFor({ state: "visible" });

    // Something typed before Edit survives it.
    await composer.fill("");
    const edit = card.locator("button.action-card__btn", { hasText: "Edit" });
    await edit.click();

    const after = await page.evaluate(() => {
      const ta = document.querySelector(
        "textarea.composer__input",
      ) as HTMLTextAreaElement | null;
      return {
        value: ta?.value ?? null,
        focused: document.activeElement === ta,
        caretAtEnd: ta ? ta.selectionStart === ta.value.length : false,
      };
    });
    expect(
      after.value === "Change the quote: ",
      `Edit puts the edit prompt in the composer (got ${
        JSON.stringify(after.value)
      })`,
    );
    expect(after.focused, "Edit focuses the composer");
    expect(after.caretAtEnd, "the caret sits after the prompt, ready to type");

    await composer.fill("make the tile $900");
    await edit.click();
    const kept = await composer.inputValue();
    expect(
      kept === "make the tile $900",
      `Edit keeps what was already typed (got ${JSON.stringify(kept)})`,
    );
  }));
