/**
 * REQ-583 (demo-loop cycle 4, run r857a9d67, M2) on the real app — pair 3: a
 * $320 deep clean for Maria Lopez, "Payment upon completion", sent and signed
 * on /q (signing schedules INV-001 and sends nothing). In the assistant, on
 * that quote's conversation, the contractor types "Invoice Maria for the deep
 * clean".
 *
 * The demo answered "…The $320 invoice (INV-001) hasn't gone out yet — it's
 * scheduled for Nov 19" with nothing to press, then "send it to her now
 * please" got "I can't send the invoice directly…". Now the answer shows
 * INV-001 as a card chipped "Scheduled" with a "Send now" button; pressing it
 * posts "Send INV-001 now", the invoice goes out (the reply says to whom and
 * how), the new card reads "Sent", and the old card's button is gone.
 *
 * Page: /assistant/[id] (island front-end/islands/AsstChat.tsx; the send is
 * backend/src/agents/domain/coordinators/chat-billing).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

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
    name: "Deb Kowalski",
    businessName: "Deb Cleans",
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

async function invoicesOf(
  http: StoryTools["http"],
  auth: Record<string, string>,
  quoteId: string,
): Promise<Invoice[]> {
  return (await (await http("/api/invoices", { headers: auth }))
    .json() as Invoice[]).filter((i) => i.quoteId === quoteId);
}

/** Pair 3: Maria's $320 deep clean, payment upon completion, sent; its
 *  conversation; Maria signs on /q, which schedules INV-001. */
async function signedDeepClean(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<{ conversationId: string; quoteId: string; invoice: Invoice }> {
  const maria = await post(http, auth, "/api/customers", {
    name: "Maria Lopez",
    email: `maria.lopez.${digits()}@blackhole.postmarkapp.com`,
  });
  const quote = await post(http, auth, "/api/quotes", {
    summary: "3-bedroom 2-bath Cleaning",
    jobName: "3-bedroom 2-bath Cleaning",
    customerId: maria.id,
    lineItems: [{
      description: "Deep clean, 4 hours",
      quantity: 1,
      unit: "job",
      price: 32000,
    }],
    estimatedTotal: 32000,
    estimatedCompletionDate: "2099-11-19",
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "Payment upon completion",
    }],
    status: "sent",
  });
  const conv = await post(http, auth, "/api/agents/conversations", {
    quoteId: quote.id,
  });
  const sent = await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ status: "sent" }),
  });
  await sent.body?.cancel();
  const accept = await http(`/api/quotes/${quote.id}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Maria Lopez", signature: SIGNATURE_PNG }),
  });
  await accept.body?.cancel();
  if (accept.status >= 400) throw new Error(`accept: ${accept.status}`);
  const [invoice, ...more] = await invoicesOf(http, auth, quote.id);
  if (!invoice?.number || invoice.status !== "scheduled" || more.length) {
    throw new Error(
      `signing should schedule one invoice: ${
        JSON.stringify([invoice, ...more])
      }`,
    );
  }
  return { conversationId: conv.id as string, quoteId: quote.id, invoice };
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

Deno.test("REQ-583 M2: 'Invoice Maria for the deep clean' shows the scheduled INV-001 with Send now; pressing it sends INV-001 — the reply says so, the new card reads Sent, the old button is gone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { conversationId, quoteId, invoice } = await signedDeepClean(
      http,
      auth,
    );
    const number = invoice.number!;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conversationId}`);
    await say(page, "Invoice Maria for the deep clean");

    const cards = page.locator("[data-cy=chat-invoice-card]", {
      hasText: number,
    });
    await cards.first().waitFor({ state: "visible", timeout: 30_000 });
    const offered = cards.first();
    await offered.hover(); // the card, on screen, in the evidence
    expect.eq(
      (await offered.locator(".action-card__chip").textContent())?.trim(),
      "Scheduled",
      "the scheduled invoice's chip says Scheduled — not the quote's Draft",
    );
    const sendNow = offered.locator("[data-cy=chat-invoice-card-send]");
    expect.eq(
      await sendNow.count(),
      1,
      "the scheduled invoice offers Send now",
    );
    expect.eq(
      (await sendNow.textContent())?.trim(),
      "Send now",
      "labelled Send now",
    );
    expect.eq(
      (await invoicesOf(http, auth, quoteId))[0].status,
      "scheduled",
      "asking about the invoice sent nothing",
    );

    // the button posts its own words; a click before hydration is a no-op,
    // so press until the words show up as the contractor's bubble
    const words = page.locator(".msg.msg--user", {
      hasText: `Send ${number} now`,
    });
    for (let i = 0; i < 20 && await words.count() === 0; i++) {
      await sendNow.click();
      await page.waitForTimeout(500);
    }
    expect.eq(await words.count(), 1, `the button posted "Send ${number} now"`);

    const reply = page.locator(".msg:not(.msg--user) .msg__bubble", {
      hasText: `Sent ${number}`,
    });
    await reply.first().waitFor({ state: "visible", timeout: 30_000 });
    const said = await reply.first().innerText();
    expect(said.includes("$320"), `the reply says $320 (got: ${said})`);
    expect(
      said.includes("Maria Lopez") && /by email/.test(said),
      `the reply says it went to Maria Lopez by email (got: ${said})`,
    );
    await expect.notSee("I can't send the invoice");

    // the reply is the end of the turn: the send already happened
    expect.eq(
      (await invoicesOf(http, auth, quoteId))[0].status,
      "sent",
      `${number} went out`,
    );
    expect.eq(
      await cards.count(),
      2,
      "the sent invoice is shown as a new card",
    );
    await cards.last().hover(); // the sent card, on screen, in the evidence
    expect.eq(
      (await cards.last().locator(".action-card__chip").textContent())?.trim(),
      "Sent",
      "the new card reads Sent",
    );
    expect.eq(
      await page.locator("[data-cy=chat-invoice-card-send]").count(),
      0,
      "no Send now is left once it went out",
    );
    expect.eq(
      (await invoicesOf(http, auth, quoteId)).length,
      1,
      "nothing new was billed",
    );
  }));
