/**
 * REQ-710 (demo-loop cycle 5, M4): pair 6's send dialog read "Quote Q-001
 * from Ortega Handyman Services — Reparación de puerta" as the ENGLISH
 * subject. The quote had been stored with English as its base (the app
 * language), so every English slot held the typed Spanish and the preview
 * saw "nothing missing" — it never asked for a translation. A quote whose
 * stored base disagrees with the language its text reads in is now sent to
 * the translator (which re-bases it) before the preview renders.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { PreviewQuoteSend } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import {
  QuoteTranslatorPort,
  type TranslateQuoteRequest,
} from "@paperwork/domain/coordinators/quote-translator-port/mod.ts";

const SPANISH = /Reparaci[oó]n de puerta/i;

Deno.test("REQ-710 (cycle 5, M4) the English subject of a quote stored with the wrong base is translated before the preview renders (pair 6)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const quotes = new QuoteStore();
    const customers = new CustomerStore();
    const identity = new BusinessIdentityStore();
    const port = new QuoteTranslatorPort();
    const calls: TranslateQuoteRequest[] = [];
    // What TranslateQuote does to this quote: re-base it on Spanish and
    // translate the English slots.
    port.register(async (req) => {
      calls.push(req);
      await quotes.update(
        req.quoteId,
        req.userId,
        {
          lang: "es",
          jobNameByLang: { es: "Reparación de puerta", en: "Door Repair" },
          summaryByLang: {
            es: "Reparación de puerta de cocina",
            en: "Kitchen door repair",
          },
        } as Parameters<QuoteStore["update"]>[2],
      );
    });
    const flow = new PreviewQuoteSend(
      quotes,
      customers,
      new UserStore(),
      identity,
      new ShortLinkStore(),
      port,
    );
    const now = new Date().toISOString();
    await (await getKv()).set(["user", "u-1"], {
      id: "u-1",
      phoneNumber: "+15125550000",
      name: "Luis Ortega",
      email: "luis@test.dev",
      language: "en",
      createdAt: now,
      updatedAt: now,
    });
    await identity.upsert("u-1", { businessName: "Ortega Handyman Services" });
    const customer = await customers.create("u-1", {
      name: "Carmen Núñez",
      email: "carmen@example.com",
    });
    const created = await quotes.create("u-1", {
      customerId: customer.id,
      summary: "Reparación de puerta de cocina",
      jobName: "Reparación de puerta",
      lineItems: [{
        description: "Reparación de puerta de cocina",
        quantity: 1,
        unit: "ea",
        price: 35_000,
      }],
      estimatedTotal: 35_000,
    });
    // As the old lock left it: English stamped as the base, the typed
    // Spanish copied into every English slot.
    const q = await quotes.update(
      created.id,
      "u-1",
      {
        lang: "en",
        jobNameByLang: {
          en: "Reparación de puerta",
          es: "Reparación de puerta",
        },
        summaryByLang: {
          en: "Reparación de puerta de cocina",
          es: "Reparación de puerta de cocina",
        },
        lineItems: [{
          description: "Reparación de puerta de cocina",
          descriptionByLang: {
            en: "Reparación de puerta de cocina",
            es: "Reparación de puerta de cocina",
          },
          quantity: 1,
          unit: "ea",
          price: 35_000,
        }],
      } as Parameters<QuoteStore["update"]>[2],
    );
    assertEquals(q.lang, "en");

    const p = await flow.run("u-1", {
      quoteId: q.id,
      channel: "email",
      lang: "en",
    });

    assertEquals(calls.length, 1, "the stale quote went to the translator");
    assert(p.email);
    assertStringIncludes(p.email.subject, "Door Repair");
    assert(
      !SPANISH.test(p.email.subject),
      `Spanish in the English subject: ${p.email.subject}`,
    );
  } finally {
    await resetKv();
  }
});
