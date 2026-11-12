/**
 * REQ-368 (demo-loop cycle 1, M32) on the real app — pair 1: a $3,200 50/50
 * repaint for John Miller, sent and signed on /q (signing bills INV-001, the
 * $1,600 deposit, and schedules the balance). In the assistant, on that
 * quote's conversation, the contractor types the demo's sentence: "John
 * signed! Please send him the deposit invoice for $1,600".
 *
 * The demo's chat re-locked the signed quote (an APPROVED card plus "Is this
 * for a business or a person?", which ended in "All terms answered.") and
 * never said the deposit invoice had already gone out. Now the reply names
 * the deposit invoice signing sent, and the card is that invoice: a "View
 * invoice" link that opens it — never the quote card's "Re-open" (which
 * posts "Re-open the quote." against the signed quote) or "Lock it in".
 *
 * Page: /assistant/[id] (island front-end/islands/AsstChat.tsx; the answer
 * comes from backend/src/agents/domain/coordinators/answer-billing).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";
const SENTENCE = "John signed! Please send him the deposit invoice for $1,600";

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
  for (
    const [path, payload] of [
      ["/api/me", { name: "Pat Painter", language: "en" }],
      ["/api/profile/identity", { businessName: "Pat Painting" }],
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
  auth: Record<string, string>,
  path: string,
  payload: unknown,
) {
  const res = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(payload),
  });
  if (res.status >= 400) {
    throw new Error(`${path}: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

interface Invoice {
  id: string;
  number?: string;
  quoteId?: string;
  amount?: number;
  status?: string;
}

/** Pair 1: the $3,200 50/50 repaint, sent; its conversation; John signs on
 *  /q, which bills the $1,600 deposit. */
async function signedRepaint(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<{ conversationId: string; deposit: Invoice; billed: number }> {
  const john = await post(http, auth, "/api/customers", {
    name: "John Miller",
    email: `john.miller.${digits()}@blackhole.postmarkapp.com`,
  });
  const quote = await post(http, auth, "/api/quotes", {
    summary: "Repaint 3 Bedrooms and Hallway",
    jobName: "Repaint",
    customerId: john.id,
    lineItems: [{
      description: "Repaint 3 bedrooms and hallway",
      quantity: 1,
      unit: "job",
      price: 320000,
    }],
    estimatedTotal: 320000,
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "50 / 50",
    }],
    status: "sent",
  });
  const conv = await post(http, auth, "/api/agents/conversations", {
    quoteId: quote.id,
  });
  const accept = await http(`/api/quotes/${quote.id}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "John Miller", signature: SIGNATURE_PNG }),
  });
  await accept.body?.cancel();
  if (accept.status >= 400) throw new Error(`accept: ${accept.status}`);
  const mine = (await (await http("/api/invoices", { headers: auth }))
    .json() as Invoice[]).filter((i) => i.quoteId === quote.id);
  const deposit = mine.find((i) => i.status === "sent" && i.amount === 160000);
  if (!deposit?.number) {
    throw new Error(`signing billed no deposit: ${JSON.stringify(mine)}`);
  }
  return {
    conversationId: conv.id as string,
    deposit,
    billed: mine.length,
  };
}

/** Type a line and send it once the island is live: a keypress before
 *  hydration is lost, so retry only while the line has not shown up as the
 *  contractor's own bubble (one that did post is never sent twice). */
async function say(page: StoryTools["page"], text: string) {
  const box = page.locator(".composer textarea.composer__input");
  const mine = page.locator(".msg.msg--user", { hasText: text });
  await box.waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await mine.count() > 0) return;
    await box.fill(text);
    await box.press("Enter");
    for (let i = 0; i < 4; i++) {
      if (await mine.count() > 0) return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`"${text}" was never sent`);
}

Deno.test("REQ-368 M32: after John signs, 'send him the deposit invoice' shows the deposit invoice signing sent — linked to it, never the quote's Re-open", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { conversationId, deposit, billed } = await signedRepaint(
      http,
      auth,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conversationId}`);
    await say(page, SENTENCE);

    const card = page.locator(".action-card", { hasText: deposit.number! });
    await card.waitFor({ state: "visible", timeout: 30_000 });
    await card.hover(); // the card, on screen, in the evidence
    const reply = page.locator(".msg:not(.msg--user) .msg__bubble", {
      hasText: deposit.number!,
    });
    expect.eq(
      await reply.count(),
      1,
      "the reply names the deposit invoice signing already sent",
    );
    const said = await reply.first().innerText();
    expect(said.includes("$1,600"), `the reply says $1,600 (got: ${said})`);
    expect(/deposit/i.test(said), `the reply says deposit (got: ${said})`);

    expect.eq(
      await card.locator("button").count(),
      0,
      "the invoice card carries none of the quote card's buttons (Re-open / Lock it in)",
    );
    const open = card.locator("a", { hasText: "View invoice" });
    expect.eq(await open.count(), 1, "the invoice card links to the invoice");
    expect.eq(
      await open.getAttribute("href"),
      `/invoices?open=${deposit.id}`,
      "the link opens that invoice on the Invoices page",
    );
    expect.eq(
      await page.locator(".action-card").count(),
      1,
      "the signed quote is not re-emitted as a card",
    );
    await expect.notSee("Is this for a business or a person?");

    const after = (await (await http("/api/invoices", { headers: auth }))
      .json() as Invoice[]).filter((i) => i.quoteId === deposit.quoteId);
    expect.eq(after.length, billed, "the chat billed nothing new");

    await open.click();
    await page.waitForURL(/\/invoices\?open=/, { timeout: 20_000 });
    const detail = page.locator("[data-cy=invoice-detail]");
    await detail.waitFor({ state: "visible", timeout: 20_000 });
    expect(
      (await detail.innerText()).includes(deposit.number!),
      `the Invoices page opens ${deposit.number}`,
    );
  }));
