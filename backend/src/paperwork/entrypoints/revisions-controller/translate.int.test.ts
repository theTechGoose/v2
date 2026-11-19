/**
 * REQ-973 (LOOP-007 cycle 1, q1-47) — "Publish revision and notify customer"
 * is a dispatch, so REQ-264's rule holds for it: the quote's line items are
 * translated into every document language before the link goes out.
 *
 * The QA run: a Spanish quote (V1's line carries { es, en }) got an English
 * chat edit that added "Baseboards" as a pending revision (the
 * apply-chat-change-order path: `quotes.setPending` with a line that has no
 * `descriptionByLang`). POST /quotes/:id/publish {notify:true} made it live
 * and e-mailed the Spanish link without running the translator, so the
 * customer's /q?lang=es showed "Baseboards $350.00" and the e-mail too.
 *
 * The translator lives in the agents module and reaches paperwork through
 * QuoteTranslatorPort (REQ-591). This test wires the REAL TranslateQuote onto
 * that port with only the model call (TranslateBullets) scripted, so the
 * base-language rules (REQ-333/710) are the shipped ones: the outcome checked
 * is what a Spanish reader sees — the e-mail and the /q payload rendered
 * through `localizeLineItems(lineItems, "es", quote.lang)`, as the page does.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import {
  QuoteTranslatorPort,
  type TranslateQuoteRequest,
} from "@paperwork/domain/coordinators/quote-translator-port/mod.ts";
import { TranslateQuote } from "@agents/domain/coordinators/translate-quote/mod.ts";
import type {
  TranslateBullets,
  TranslateBulletsInput,
} from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { localizeLineItems } from "#quote-flow/quote-translations.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 9747;
const BASE = `http://localhost:${PORT}`;

/** What the scripted model "knows", per target language. */
const DICT: Record<"en" | "es", Record<string, string>> = {
  es: { Baseboards: "Zócalos", "Wall painting": "Pintura de paredes" },
  en: {
    "Pintura de paredes": "Wall painting",
    "Pintura interior": "Interior painting",
    Zócalos: "Baseboards",
  },
};

async function drain(res: Response) {
  await res.body?.cancel();
}
function auth(sid: string) {
  return { "content-type": "application/json", "x-session-id": sid };
}
async function post(
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function put(
  path: string,
  headers: Record<string, string>,
  body: unknown,
) {
  return await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}
async function login(phone = "+15125550973"): Promise<string> {
  await drain(
    await post("/auth/send-otp", { "content-type": "application/json" }, {
      phoneNumber: phone,
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await post("/auth/verify-otp", {
    "content-type": "application/json",
  }, { phoneNumber: phone, code: stored!.code }).then((r) => r.json());
  await drain(
    await put("/me", auth(v.sessionId), {
      name: "Rafa Castro",
      language: "en",
    }),
  );
  return v.sessionId;
}

type Line = {
  description: string;
  descriptionByLang?: Record<string, string>;
  quantity?: number;
  unit?: string;
  price?: number;
};

async function withServer(
  fn: (
    ctx: {
      app: DanetApplication;
      calls: TranslateQuoteRequest[];
      emails: SendEmailInput[];
    },
  ) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  const calls: TranslateQuoteRequest[] = [];
  const emails: SendEmailInput[] = [];
  // the e-mail seam: capture what would go to Postmark
  app.get(EmailService).send = (input: SendEmailInput) => {
    emails.push(input);
    return Promise.resolve({ ok: true });
  };
  // the real TranslateQuote on the port, with the model call scripted
  const bullets = {
    run: (input: TranslateBulletsInput) =>
      Promise.resolve({
        texts: input.texts.map((t) =>
          input.from === input.to ? t : DICT[input.to][t] ?? t
        ),
        translated: true,
      }),
  } as unknown as TranslateBullets;
  const port = app.get(QuoteTranslatorPort);
  const real = new TranslateQuote(app.get(QuoteStore), bullets);
  port.register(async (req) => {
    calls.push(req);
    await real.run(req);
  });
  await app.listen(PORT);
  try {
    await fn({ app, calls, emails });
  } finally {
    await app.close();
    await resetKv();
  }
}

Deno.test("REQ-973 (LOOP-007 q1-47): publishing a revision of a Spanish quote with notify translates the new English line before the Spanish link goes out", async () => {
  await withServer(async ({ app, calls, emails }) => {
    const sid = await login();
    const c = await post("/customers", auth(sid), {
      name: "Jose Ramirez",
      email: "jose@example.com",
      address: "1 Main St",
      language: "es",
    }).then((r) => r.json());
    const q = await post("/quotes", auth(sid), {
      summary: "Pintura interior",
      customerId: c.id,
      lang: "es",
      lineItems: [{
        description: "Pintura de paredes",
        descriptionByLang: { es: "Pintura de paredes", en: "Wall painting" },
        quantity: 1,
        unit: "job",
        price: 100000,
      }],
      estimatedTotal: 100000,
    }).then((r) => r.json());
    assert(q.id, `the quote was created: ${JSON.stringify(q)}`);
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));

    // the chat's change order on an issued, unsigned quote (REQ-201):
    // apply-chat-change-order appends `{description, quantity, unit, price}`
    // and stores it as the pending revision
    const quotes = app.get(QuoteStore);
    const live = await quotes.getOwned(q.id, q.userId);
    const lineItems = [
      ...live.lineItems,
      { description: "Baseboards", quantity: 1, unit: "ea", price: 35000 },
    ];
    await quotes.setPending(q.id, q.userId, {
      lineItems,
      estimatedTotal: 135000,
    });
    assert(
      (await quotes.getOwned(q.id, q.userId)).pendingRevision,
      "the change order is a pending revision",
    );

    const res = await post(`/quotes/${q.id}/publish`, auth(sid), {
      notify: true,
      language: "es",
    });
    assertEquals(res.status, 200);
    const published = await res.json();
    assertEquals(published.version, 2, "V2 is live");

    assert(
      calls.some((c) => c.quoteId === q.id),
      `REQ-973: publish-and-notify runs the quote translator (REQ-264 "before every dispatch") — translator calls: ${
        JSON.stringify(calls)
      }`,
    );

    const pub = await fetch(`${BASE}/quotes/${q.id}/public?refresh=1`).then((
      r,
    ) => r.json());
    const esLines = localizeLineItems(pub.lineItems as Line[], "es", pub.lang)
      .map((li) => li.description);
    assertEquals(
      esLines,
      ["Pintura de paredes", "Zócalos"],
      `REQ-973: /q?lang=es renders V2's new line in Spanish (stored lang=${pub.lang}, lines=${
        JSON.stringify(pub.lineItems)
      })`,
    );

    const mail = emails.find((e) => e.to.includes("jose@example.com")) ??
      emails[0];
    assert(mail, `the revision was e-mailed: ${emails.length} e-mails`);
    assert(
      mail.htmlBody.includes("Zócalos"),
      "REQ-973: the Spanish e-mail lists the new line in Spanish",
    );
    assert(
      !mail.htmlBody.includes("Baseboards"),
      'REQ-973: the Spanish e-mail does not show the English "Baseboards"',
    );
  });
});
