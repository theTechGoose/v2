/**
 * REQ-771 (demo-loop cycle 5v5, M7) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * The verifier's exact help-me-price run: the details-first note "Bathroom
 * floor for Ana Diaz at 22 Oak St: install LVP no wait porcelain tile 12x24
 * on the floor, plus a recessed shower niche. Has to be done before
 * Thanksgiving." is the thread's first user message (POST /:id/draft
 * {note}); the quote is created, the terms wizard runs to the end — and the
 * finished Q-003 named Thanksgiving nowhere. REQ-653 only SAID a deadline
 * (and only when the schedule missed it); it never stored it on the quote.
 */
import { assert, assertEquals, assertMatch } from "#std/assert";
import { HandleWizardAnswer } from "./mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { readDeadline } from "@agents/domain/business/terms-edit/mod.ts";
import { localizeTermValue as pdfLocalize } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";

const VERIFIER_NOTE =
  "Bathroom floor for Ana Diaz at 22 Oak St: install LVP no wait porcelain tile 12x24 on the floor, plus a recessed shower niche. Has to be done before Thanksgiving.";

async function helpMePriceRun(note: string) {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const wizard = new HandleWizardAnswer(
    conversations,
    messages,
    quotes,
    customers,
    new UserStore(),
    new EventBus(),
  );
  const conv = await conversations.create({ userId: "u-1" });
  // ensureConversationForDraft: the typed details are the first user message
  await messages.append({
    conversationId: conv.id,
    role: "user",
    kind: "text",
    content: note,
  });
  const quote = await quotes.create("u-1", {
    summary: "Install porcelain tile 12x24 (22 Oak St)",
    jobName: "Install porcelain tile 12x24 (22 Oak St)",
    description:
      "Install porcelain tile 12x24 (22 Oak St)\nBuild a recessed shower niche",
    lineItems: [{
      description: "Install porcelain tile 12x24",
      quantity: 1,
      unit: "ea",
      price: 240_000,
    }],
    estimatedTotal: 240_000,
    serviceAddress: "22 Oak St",
  });
  await conversations.update(conv.id, { quoteId: quote.id });
  await new TransitionToTerms(conversations, messages).run({
    userId: "u-1",
    conversationId: conv.id,
  });
  for (
    const [stepId, optionId, customValue] of [
      ["customer", "create_new", "Ana Diaz"],
      ["start_date", "asap"],
      ["wraps", "1_week"],
      ["payment_terms", "50_50"],
      ["warranty", "12_months"],
    ]
  ) {
    await wizard.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId: stepId!,
      optionId: optionId!,
      ...(customValue ? { customValue } : {}),
    });
  }
  return await quotes.getOwned(quote.id, "u-1");
}

Deno.test("REQ-771 M7 (cycle 5v5): the verifier's help-me-price run — the finished quote carries 'Deadline: Before Thanksgiving' as a term", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const q = await helpMePriceRun(VERIFIER_NOTE);
  const terms = q.terms ?? [];
  const row = terms.find((t) => t.stepId === "deadline");
  assert(
    row,
    `no deadline term on the quote: ${JSON.stringify(terms)}`,
  );
  assertMatch(row!.value, /^Before \d{4}-11-\d{2} \(Thanksgiving\)$/);
  assertEquals(row!.label, "Deadline");
  // the wizard's own rows are all still there, the deadline after the
  // time to complete
  assertEquals(terms.map((t) => t.stepId), [
    "start_date",
    "wraps",
    "deadline",
    "payment_terms",
    "warranty",
  ]);
  // the PDF reads it too
  assertMatch(
    pdfLocalize(row!.value, "en"),
    /^Before Thanksgiving \(Nov \d{1,2}, \d{4}\)$/,
  );
  assertMatch(
    pdfLocalize(row!.value, "es"),
    /^Antes de Acción de Gracias \(\d{1,2} nov \d{4}\)$/,
  );
  await resetKv();
});

Deno.test("REQ-771 M7: no deadline typed → no deadline term", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const q = await helpMePriceRun(
    "Bathroom floor for Ana Diaz at 22 Oak St: install porcelain tile 12x24.",
  );
  assertEquals(
    (q.terms ?? []).some((t) => t.stepId === "deadline"),
    false,
  );
  await resetKv();
});

Deno.test("REQ-771 M7: readDeadline names the holiday it read", () => {
  const d = readDeadline(VERIFIER_NOTE, new Date(2026, 10, 12));
  assertEquals(d, { iso: "2026-11-26", before: true, holiday: "thanksgiving" });
  assertEquals(
    readDeadline("finished by Dec 5", new Date(2026, 10, 12))?.holiday,
    undefined,
  );
});
