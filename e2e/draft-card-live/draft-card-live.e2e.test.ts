/**
 * REQ-660 — Raphael, 2026-11-12, demo-loop cycle 5: "fix every issue the
 * demo found, loop until there are none." Demo issue M24, "Old quote card
 * keeps a live 'Lock it in' with the stale price after correction": a
 * correction changed the quote to $8,700 but the draft card above the reply
 * still read "Total $532.50" with a live Lock it in.
 *
 * On /assistant/[id] (island AsstChat; the rule in
 * front-end/lib/chat-draft-card.ts): the draft card of the thread's quote
 * shows the quote's current lines and total, and Lock it in sits under that
 * current total — never under the snapshot the card was appended with.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

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
  for (
    const [path, payload] of [
      ["/api/me", { name: "Card User", language: "en" }],
      ["/api/profile/identity", { businessName: "Card Business" }],
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
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

async function post(
  http: StoryTools["http"],
  headers: Record<string, string>,
  path: string,
  payload?: unknown,
) {
  const res = await http(path, {
    method: "POST",
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return await res.json().catch(() => ({}));
}

Deno.test("REQ-660: the draft quote card shows the quote's current total after its price changed, with Lock it in under that total", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    const quote = await post(http, auth, "/api/quotes", {
      summary: "Drywall patch",
      jobName: "Drywall patch",
      lineItems: [{
        description: "Drywall patch",
        quantity: 1,
        unit: "ea",
        price: 53250,
      }],
      estimatedTotal: 53250,
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    // Lock, then re-open: the thread now carries a DRAFT card whose payload
    // snapshots $532.50.
    await post(http, auth, `/api/agents/conversations/${conv.id}/lock-quote`, {
      quoteId: quote.id,
    });
    const reopened = await post(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/reopen-quote`,
      { quoteId: quote.id },
    );
    expect(
      (reopened.newMessages ?? []).some((m: { kind?: string }) =>
        m.kind === "action_card"
      ),
      "re-open appended the draft card",
    );
    // The correction: the quote is now $8,700 (what revise_quote does).
    const put = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        lineItems: [{
          description: "Drywall repair, 3 rooms",
          quantity: 1,
          unit: "ea",
          price: 870000,
        }],
        estimatedTotal: 870000,
      }),
    });
    await put.body?.cancel();
    expect(put.status < 400, `PUT the corrected quote: ${put.status}`);

    await page.goto(`/assistant/${conv.id}`);
    const lock = page.locator(".action-card__btn--primary");
    await lock.first().waitFor({ state: "visible", timeout: 25_000 });
    expect.eq(await lock.count(), 1, "one Lock it in in the thread");
    const card = page.locator(".action-card").filter({ has: lock });
    const text = (await card.first().innerText()).replace(/\s+/g, " ");
    expect(
      /\$8,700/.test(text),
      `the card with Lock it in shows the current $8,700 (card: ${text})`,
    );
    expect(
      !/\$532\.50/.test(text),
      `the card no longer shows the stale $532.50 (card: ${text})`,
    );
    expect(
      /Drywall repair, 3 rooms/.test(text),
      `the card shows the current line (card: ${text})`,
    );
  }));
