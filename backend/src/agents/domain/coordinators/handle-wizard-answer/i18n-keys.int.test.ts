/**
 * REQ-589 (demo-loop cycle 4, M15) — the wizard's chat lines carry their
 * i18n key, so they re-render after an EN/ES switch.
 *
 * TransitionToTerms and HandleWizardAnswer wrote the divider, the question,
 * the option labels, the pick line and the thread preview already translated
 * into the contractor's language at the time; the island printed them
 * verbatim. Each line now stores `payload.i18n` ({key, vars}) — and each
 * option `i18n.label` — which the shared renderer resolves in any language.
 */
import { assert, assertEquals } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { HandleWizardAnswer } from "./mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  type ChatI18nRef,
  localizeChatMessage,
  localizedPreview,
  renderChatI18n,
} from "#quote-flow/chat-i18n.ts";

const tr = (
  lang: "en" | "es",
  key: string,
  vars?: Record<string, string | number>,
) => t(lang, key, vars);

async function setupSpanish() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const users = new UserStore();
  const customers = new CustomerStore();
  const user = await users.create({ phoneNumber: "+15125550177" });
  await users.update(user.id, { language: "es" });
  const bound = await customers.create(user.id, { name: "Carmen Ruiz" });
  const conv = await conversations.create({
    userId: user.id,
    customerId: bound.id,
  });
  const transition = new TransitionToTerms(conversations, messages);
  const flow = new HandleWizardAnswer(
    conversations,
    messages,
    new QuoteStore(),
    customers,
    users,
    new EventBus(),
  );
  const first = await transition.run({
    userId: user.id,
    conversationId: conv.id,
    lang: "es",
  });
  return { conversations, messages, user, conv, flow, first };
}

Deno.test("REQ-589 M15 transition-to-terms: the divider, the question and its options carry their keys", async () => {
  const { first } = await setupSpanish();
  const [divider, wizard] = first.newMessages;
  assertEquals(divider.content, "Un poco más de información");
  const dEn = localizeChatMessage(divider, "en", tr);
  assertEquals(dEn.content, "A little more info");
  assertEquals((dEn.payload as { label?: string }).label, "A little more info");

  assertEquals(wizard.content, t("es", "termsWizard.customer.questionKnown"));
  const wEn = localizeChatMessage(wizard, "en", tr);
  assertEquals(wEn.content, t("en", "termsWizard.customer.questionKnown"));
  const opts = (wEn.payload as { options: { id: string; label: string }[] })
    .options;
  assertEquals(
    opts.find((o) => o.id === "use_active")?.label,
    t("en", "termsWizard.customer.useActive"),
  );
  await resetKv();
});

Deno.test("REQ-589 M15 handle-wizard-answer: a Spanish pick line, the next question and the preview re-render in English", async () => {
  const { conversations, user, conv, flow } = await setupSpanish();
  await flow.run({
    userId: user.id,
    conversationId: conv.id,
    stepId: "customer",
    optionId: "use_active",
  });
  const r = await flow.run({
    userId: user.id,
    conversationId: conv.id,
    stepId: "start_date",
    optionId: "next_week",
  });
  const [pick, next] = r.newMessages;
  assertEquals(pick.content, "Inicio: La próxima semana");
  const ref = (pick.payload as { i18n?: ChatI18nRef }).i18n;
  assert(ref, "the pick line stores its key");
  assertEquals(renderChatI18n(ref!, "en", tr), "Start: Next week");
  assertEquals(localizeChatMessage(pick, "en", tr).content, "Start: Next week");
  // The answer's ids stay on the payload (the island folds answered steps).
  assertEquals(
    (pick.payload as { wizardStepId?: string }).wizardStepId,
    "start_date",
  );

  const nextEn = localizeChatMessage(next, "en", tr);
  assertEquals(nextEn.content, t("en", "termsWizard.wraps.question"));
  const opts = (nextEn.payload as { options: { id: string; label: string }[] })
    .options;
  assertEquals(
    opts.find((o) => o.id === "1_week")?.label,
    t("en", "termsWizard.wraps.oneWeek"),
  );

  const stored = await conversations.get(conv.id);
  assertEquals(stored.preview, "Inicio: La próxima semana");
  assertEquals(localizedPreview(stored, "en", tr), "Start: Next week");
  await resetKv();
});

Deno.test("REQ-589 M15 handle-wizard-answer: a picked date and a bound customer's name re-render", async () => {
  const { user, conv, flow } = await setupSpanish();
  const c = await flow.run({
    userId: user.id,
    conversationId: conv.id,
    stepId: "customer",
    optionId: "use_active",
  });
  assertEquals(
    localizeChatMessage(c.newMessages[0], "en", tr).content,
    `${t("en", "termsWizard.customer.label")}: Carmen Ruiz`,
  );
  const r = await flow.run({
    userId: user.id,
    conversationId: conv.id,
    stepId: "start_date",
    optionId: "custom",
    customValue: "2026-12-01",
  });
  assertEquals(r.newMessages[0].content, "Inicio: 1 dic 2026");
  assertEquals(
    localizeChatMessage(r.newMessages[0], "en", tr).content,
    "Start: Dec 1, 2026",
  );
  await resetKv();
});

Deno.test("REQ-589 M15 conversation store: a later plain preview drops the stale preview key", async () => {
  const { conversations, user, conv, flow } = await setupSpanish();
  await flow.run({
    userId: user.id,
    conversationId: conv.id,
    stepId: "customer",
    optionId: "use_active",
  });
  const withKey = await conversations.get(conv.id);
  assert(
    (withKey as { previewI18n?: unknown }).previewI18n,
    "the pick stored a preview key",
  );
  const after = await conversations.update(conv.id, { preview: "hola" });
  assertEquals((after as { previewI18n?: unknown }).previewI18n, undefined);
  assertEquals(localizedPreview(after, "en", tr), "hola");
  await resetKv();
});
