/**
 * REQ-701 (demo-loop cycle 5, issue M21) — what the assistant says about a
 * client's question, from the stored questions (AnswerInquiries).
 *
 * Pair 9 asked "¿dónde le contesto?" and got the INV-001 status: the chat
 * knew nothing of Linda's question. A WHERE ask is always answered from the
 * waiting questions (or says none is waiting). A HOW-to-reply ask that names
 * no question ("how should I respond to him? he says the price is too
 * high") is advice as much as an inquiry ask: it is answered from a question
 * only when the person it names, or the thread's quote, has one waiting —
 * otherwise nothing is written and the chat model answers it.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteInquiryStore } from "@paperwork/domain/data/inquiry-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { AnswerInquiries } from "./mod.ts";

const ROSA = "u-rosa";
const LINDA_Q =
  "¿Pueden venir el sábado en la mañana? ¿Se llevan también un colchón?";
const JOHN_Q = "Do you haul the old fence panels too?";

async function withKv(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    await fn();
  } finally {
    await resetKv();
  }
}

/** Rosa's two quotes, each with its client's question waiting. */
async function seed() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const inquiries = new QuoteInquiryStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const answer = new AnswerInquiries(
    conversations,
    messages,
    inquiries,
    quotes,
    customers,
  );
  const linda = await customers.create(ROSA, { name: "Linda Morales" });
  const john = await customers.create(ROSA, { name: "John Miller" });
  const lindaQuote = await quotes.create(ROSA, {
    customerId: linda.id,
    summary: "Retiro de muebles",
    jobName: "Retiro de muebles",
    lineItems: [],
  });
  const johnQuote = await quotes.create(ROSA, {
    customerId: john.id,
    summary: "Fence removal",
    jobName: "Fence removal",
    lineItems: [],
  });
  const lindaAsked = await inquiries.create({
    quoteId: lindaQuote.id,
    userId: ROSA,
    customerId: linda.id,
    question: LINDA_Q,
    contactBack: "linda.morales@example.com",
    name: "Linda Morales",
    lang: "es",
  });
  const johnAsked = await inquiries.create({
    quoteId: johnQuote.id,
    userId: ROSA,
    customerId: john.id,
    question: JOHN_Q,
    name: "John Miller",
    lang: "en",
  });
  assert(lindaAsked && johnAsked);
  return {
    conversations,
    messages,
    inquiries,
    quotes,
    answer,
    lindaQuote,
    johnQuote,
    lindaAsked,
  };
}

Deno.test("REQ-701 M21 a WHERE ask names every waiting question, with the quote and how to reach the client, and links the first one's quote", () =>
  withKv(async () => {
    const s = await seed();
    const conv = await s.conversations.create({ userId: ROSA });
    const r = await s.answer.run({
      userId: ROSA,
      conversation: conv,
      lang: "es",
      text: "¿dónde le contesto?",
    });
    assert(r, "a where-ask is always answered");
    assertEquals(r.newMessages.length, 1);
    const text = r.newMessages[0].content;
    assertStringIncludes(text, LINDA_Q);
    assertStringIncludes(text, JOHN_Q);
    assertStringIncludes(text, "linda.morales@example.com");
    assertStringIncludes(text, "Preguntas del cliente");
    const stored = await s.messages.listByConversation(conv.id);
    assertEquals(stored.map((m) => m.content), [text]);
  }));

Deno.test("REQ-701 M21 a WHERE ask that names the client answers with that client's question only", () =>
  withKv(async () => {
    const s = await seed();
    const conv = await s.conversations.create({ userId: ROSA });
    const r = await s.answer.run({
      userId: ROSA,
      conversation: conv,
      lang: "es",
      text: "¿dónde le contesto a Linda?",
    });
    assert(r);
    const text = r.newMessages[0].content;
    assertStringIncludes(text, LINDA_Q);
    assert(!text.includes(JOHN_Q), text);
    assertEquals(
      (r.newMessages[0].payload?.inquiry as { quoteId?: string })?.quoteId,
      s.lindaQuote.id,
    );
  }));

Deno.test("REQ-701 M21 a WHERE ask with nothing waiting says so — answered and deleted-quote questions are not waiting", () =>
  withKv(async () => {
    const s = await seed();
    await s.inquiries.markAnswered(s.lindaQuote.id, s.lindaAsked.id, {
      channel: "email",
      to: "linda.morales@example.com",
      message: "Sí, el sábado a las 9.",
    });
    await s.quotes.delete(s.johnQuote.id, ROSA);
    const conv = await s.conversations.create({ userId: ROSA });
    const r = await s.answer.run({
      userId: ROSA,
      conversation: conv,
      lang: "en",
      text: "where do I answer her?",
    });
    assert(r);
    assertStringIncludes(
      r.newMessages[0].content,
      "No client question is waiting for an answer",
    );
  }));

Deno.test("REQ-701 M21 a HOW-to-reply ask (onlyRelevant) about someone with no waiting question writes nothing — the chat model answers it", () =>
  withKv(async () => {
    const s = await seed();
    const conv = await s.conversations.create({ userId: ROSA });
    const r = await s.answer.run({
      userId: ROSA,
      conversation: conv,
      lang: "en",
      text: "How should I reply to Ana? She says the price is too high",
      onlyRelevant: true,
    });
    assertEquals(r, undefined);
    assertEquals(await s.messages.listByConversation(conv.id), []);

    // and with nothing waiting at all
    const none = await s.answer.run({
      userId: "u-nobody",
      conversation: await s.conversations.create({ userId: "u-nobody" }),
      lang: "es",
      text: "¿Cómo le respondo? Dice que el precio es muy alto",
      onlyRelevant: true,
    });
    assertEquals(none, undefined);
  }));

Deno.test("REQ-701 M21 a HOW-to-reply ask (onlyRelevant) naming a client who asked answers with her question", () =>
  withKv(async () => {
    const s = await seed();
    const conv = await s.conversations.create({ userId: ROSA });
    const r = await s.answer.run({
      userId: ROSA,
      conversation: conv,
      lang: "es",
      text: "¿Cómo le respondo a Linda?",
      onlyRelevant: true,
    });
    assert(r, "Linda's question is waiting");
    assertStringIncludes(r.newMessages[0].content, LINDA_Q);
    assert(!r.newMessages[0].content.includes(JOHN_Q));
  }));

Deno.test("REQ-701 M21 a HOW-to-reply ask (onlyRelevant) in a quote's thread answers with that quote's waiting question", () =>
  withKv(async () => {
    const s = await seed();
    const conv = await s.conversations.create({
      userId: ROSA,
      quoteId: s.johnQuote.id,
    });
    const r = await s.answer.run({
      userId: ROSA,
      conversation: conv,
      lang: "en",
      text: "How do I reply to him about the panels?",
      onlyRelevant: true,
    });
    assert(r, "John's question is waiting on this thread's quote");
    assertStringIncludes(r.newMessages[0].content, JOHN_Q);
    assert(!r.newMessages[0].content.includes(LINDA_Q));
  }));
