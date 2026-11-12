/**
 * REQ-464 — demo-loop cycle 3, demo issue m33: "'Edit' on the quote card only
 * types 'Change the quote:', which stays after 'Lock it in'."
 *
 * Edit (REQ-246) seeds the composer with "Change the quote: ". Lock it in used
 * to leave that seed behind, so the composer still asked for a change to a
 * quote that was now locked. Now the bare seed is cleared when the card is
 * locked, and while the seed sits in the composer a hint says what to type.
 *
 * Page: front-end/routes/assistant/index.tsx (island
 * front-end/islands/AsstChat.tsx). The conversation load and the
 * /lock-quote call are answered by page.route, so no LLM is involved.
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
    name: "Seed User",
    businessName: "Seed Business",
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

Deno.test("REQ-464: Lock it in clears a bare Edit seed; the seed shows a hint", (t) =>
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
    const card = (status: string) => ({
      id: status === "draft" ? "m-card" : "m-locked",
      conversationId: id,
      role: "assistant",
      kind: "action_card",
      content: "Quote drafted",
      createdAt: now - 1000,
      payload: {
        actionType: "quote",
        status,
        quoteId: "q-req464",
        lineItems: [
          { description: "Tile install", amountCents: 300000 },
          { description: "Materials", amountCents: 60000 },
        ],
        totalCents: 360000,
      },
    });
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
                content: "Quote a bathroom tile job, $3,600",
                createdAt: now - 2000,
              },
              card("draft"),
            ],
          }),
        }),
    );
    await page.route(
      `**/api/agents/conversations/${id}/lock-quote`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ conversation, newMessages: [card("locked")] }),
        }),
    );

    await page.goto(`/assistant?c=${id}`);
    const draftCard = page.locator(".action-card", { hasText: "Tile install" });
    await draftCard.waitFor({ state: "visible" });
    const composer = page.locator("textarea.composer__input");
    await composer.waitFor({ state: "visible" });
    await composer.fill("");

    await draftCard.locator("button.action-card__btn", { hasText: "Edit" })
      .click();
    expect(
      (await composer.inputValue()) === "Change the quote: ",
      "Edit seeds the composer (REQ-246)",
    );
    const hint = page.locator(".composer__hint", {
      hasText: "Type the change, e.g. tile $3,600",
    });
    await hint.waitFor({ state: "visible", timeout: 5000 });

    await draftCard.locator("button.action-card__btn", {
      hasText: "Lock it in",
    }).click();
    await page.locator("button.action-card__btn", { hasText: "Re-open" })
      .waitFor({ state: "visible" });
    const left = await composer.inputValue();
    expect(
      left === "",
      `Lock it in clears the bare Edit seed (got ${JSON.stringify(left)})`,
    );
    expect(
      (await hint.count()) === 0,
      "the edit hint goes away with the seed",
    );
  }));
