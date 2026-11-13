/**
 * REQ-710 (demo-loop cycle 5, M4): "Lock it in" on pair 6's quote. The app
 * was in English and the quote was typed in Spanish; LockQuote passed the
 * app language as the base (`baseLang: me.language`), so the English slots
 * got the typed Spanish verbatim and the English preview, /q?lang=en and the
 * English e-mail subject all kept "Reparación de puerta". Lock now lets the
 * typed text name the base: Spanish stays verbatim, English is translated.
 */
import { assert, assertEquals } from "#std/assert";
import { LockQuote } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { TranslateQuote } from "@agents/domain/coordinators/translate-quote/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";

const EN_OF: Record<string, string> = {
  "Reparación de puerta": "door repair",
  "Reparación de puerta de cocina y cambio de llave del fregadero":
    "Kitchen door repair and sink faucet replacement",
  "Reparación de puerta de cocina": "Kitchen door repair",
  "Cambio de llave del fregadero": "Kitchen sink faucet replacement",
};

Deno.test("REQ-710 (cycle 5, M4) Lock it in on an English-app contractor's Spanish quote translates it INTO English (pair 6)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const prompts: string[] = [];
    const llm = new StubLLMClient();
    llm.setHandler((req) => {
      prompts.push(req.systemPrompt ?? "");
      const { texts } = JSON.parse(req.messages[0].content as string) as {
        texts: string[];
      };
      const toEn = /bullet lines into English/.test(req.systemPrompt ?? "");
      return {
        text: JSON.stringify({
          texts: texts.map((t) => toEn ? (EN_OF[t] ?? t) : `${t} (es)`),
        }),
      };
    });
    const users = new UserStore();
    const me = await users.create({
      phoneNumber: "+15550000711",
      language: "en", // pair 6: the app is in English
    });
    const conversations = new AgentConversationStore();
    const quotes = new QuoteStore();
    const flow = new LockQuote(
      conversations,
      new AgentMessageStore(),
      quotes,
      users,
      new TranslateQuote(quotes, new TranslateBullets(llm), users),
    );
    const conv = await conversations.create({
      userId: me.id,
      currentPhase: "quote",
    });
    const quote = await quotes.create(me.id, {
      summary: "Reparación de puerta de cocina y cambio de llave del fregadero",
      jobName: "Reparación de puerta",
      lineItems: [
        {
          description: "Reparación de puerta de cocina",
          quantity: 1,
          unit: "ea",
          price: 17_500,
        },
        {
          description: "Cambio de llave del fregadero",
          quantity: 1,
          unit: "ea",
          price: 17_500,
        },
      ],
      estimatedTotal: 35_000,
    }, { jobNameLang: "en" });
    await conversations.update(conv.id, { quoteId: quote.id });

    await flow.run({
      userId: me.id,
      conversationId: conv.id,
      quoteId: quote.id,
    });

    const after = await quotes.getOwned(quote.id, me.id);
    assert(after.lockedAt, "locked");
    assertEquals(after.lang, "es", "the base is the language it was typed in");
    assertEquals(after.jobNameByLang, {
      es: "Reparación de puerta",
      en: "Door Repair",
    });
    assertEquals(
      after.summaryByLang?.en,
      "Kitchen door repair and sink faucet replacement",
    );
    assertEquals(after.lineItems.map((li) => li.descriptionByLang?.en), [
      "Kitchen door repair",
      "Kitchen sink faucet replacement",
    ]);
    assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), [
      "Reparación de puerta de cocina",
      "Cambio de llave del fregadero",
    ]);
    assertEquals(prompts.length, 1, "one model call");
    assert(/bullet lines into English/.test(prompts[0]), prompts[0]);
  } finally {
    await resetKv();
  }
});
