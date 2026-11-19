/**
 * REQ-1048 (LOOP-007 cycle 2, q2-32) — "Deposit timing contradicts itself:
 * '30% upfront' vs 'Due a week after signing' vs 'pay now'".
 *
 * Drives the real terms-wizard coordinators (TransitionToTerms →
 * HandleWizardAnswer, KV :memory:) to the payment step the contractor sees
 * in chat. The "Deposit + balance" and "50/50" options it emits must not
 * promise the first payment "upfront" / "por adelantado": REQ-240/REQ-954 bill
 * it at signing + SIGNING_NET_DAYS (7), and the quote / email / PDF print
 * exactly that ("Due a week after signing" → "Due Nov 26").
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
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { SIGNING_NET_DAYS } from "#documents/linked-view.ts";

const UPFRONT: Record<"en" | "es", RegExp> = {
  en: /up[\s-]?front/i,
  es: /por adelantado/i,
};

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1048 (LOOP-007 q2-32) [${lang}]: the payment step the wizard emits never says the deposit / first half is paid "upfront" — it is billed net-${SIGNING_NET_DAYS} from signing`, async () => {
    Deno.env.set("KV_PATH", ":memory:");
    await resetKv();
    try {
      const conversations = new AgentConversationStore();
      const messages = new AgentMessageStore();
      const quotes = new QuoteStore();
      const users = new UserStore();
      const transition = new TransitionToTerms(conversations, messages);
      const flow = new HandleWizardAnswer(
        conversations,
        messages,
        quotes,
        new CustomerStore(),
        users,
        new EventBus(),
      );
      const user = await users.create({
        phoneNumber: lang === "en" ? "+15125551048" : "+15125552048",
      });
      await users.update(user.id, { language: lang });
      const quote = await quotes.create(user.id, {
        summary: "Kitchen remodel",
        lineItems: [],
        estimatedTotal: 8_400_00,
        status: "draft",
      });
      const conv = await conversations.create({
        userId: user.id,
        quoteId: quote.id,
        customerId: "cust-1048",
      });
      await transition.run({ userId: user.id, conversationId: conv.id, lang });
      let last: AgentMessage | undefined;
      for (const step of TERMS_WIZARD_V1.steps) {
        if (step.id === "payment_terms") break;
        const opt = step.options.find((o) => !o.isCustom)!;
        const r = await flow.run({
          userId: user.id,
          conversationId: conv.id,
          stepId: step.id,
          optionId: opt.id,
        });
        last = r.newMessages.at(-1);
      }
      const p = last?.payload as {
        stepId?: string;
        options?: { id: string; sub?: string }[];
      };
      assertEquals(p.stepId, "payment_terms");
      const subs = (p.options ?? [])
        .filter((o) => o.id === "deposit_bal" || o.id === "50_50")
        .map((o) => [o.id, o.sub ?? ""] as const);
      assertEquals(subs.length, 2, "deposit_bal and 50_50 are offered");
      const week = t(lang, "quoteDoc.milestone.weekAfterSigning");
      const bad = subs.filter(([, s]) => UPFRONT[lang].test(s));
      assert(
        bad.length === 0,
        `the quote will say the deposit is "${week}", but the payment step offers:\n${
          bad.map(([id, s]) => `  ${id}: "${s}"`).join("\n")
        }`,
      );
    } finally {
      await resetKv();
    }
  });
}
