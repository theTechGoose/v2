/**
 * RED (TDD) — UX-28 over real HTTP: the same contractor + customer must get
 * ONE outbound language across doc types.
 *
 * Finding (ux-problems.md, verbatim fragment):
 *  UX-28 "Outbound language is inconsistent for the same contractor +
 *         customer. Rafa's quote SMS went out in Spanish ('Hola María, soy
 *         Rafa de Techos Morales…') but his invoice SMS in English ('Hi
 *         María, your invoice is ready…') — the two send paths resolve
 *         commsLanguage differently."
 *
 * Scenario (mirrors the audited session exactly): an ES contractor whose
 * identity has a businessName but NO stored commsLanguage — the state a
 * fresh Spanish-first signup is in. The quote/agreement text goes out
 * through the ASSISTANT's send path with the explicit Spanish pick the UI
 * passes (AsstChat confirmSendQuote(m, channel, previewLang) →
 * POST /agents/conversations/:id/send-quote
 * {channel:"sms", language:"es"}); the invoice text goes out through the
 * path the assistant's invoice flow uses (AsstChat.tsx:3225-3236, 4279-4289
 * → POST /invoices/:id/text, which has NO language parameter —
 * paperwork-email-controller/mod.ts:23-26,195-206).
 *
 * NOTE on "quote text": the plain POST /quotes/:id/text cannot carry the
 * assistant's language pick at all, so the honest reproduction of the
 * audited divergence is assistant-quote-text vs invoice-text — the two
 * dispatches the audited user actually fired. (Both plain /text routes,
 * probed, resolve identically from the stored default — the divergence
 * needs the assistant leg.)
 *
 * Observable: GET /messages (channel "text", paperworkId = quote id /
 * invoice id).
 *
 * Live probe (2026-08-19, this exact flow, phone +15125556210):
 *   CONTRACT SMS: "Hola María, soy Rafa de Techos Probe LLC.\n\nTu
 *                  Cotización + Acuerdo para Reparación de techo está
 *                  lista: http://localhost:5280/s/1o1hBI…"      → Spanish
 *   INVOICE  SMS: "Hi María, your invoice is ready ($3,700). View & pay:
 *                  http://localhost:5280/s/GYnz1g — Rafa"        → English
 *
 * DESIRED: one resolution (shared/quote-flow/comms-language.ts — see
 * jest/unit/ux-comms-language.test.ts) ⇒ both texts land in the SAME
 * language. Which language wins is the green agent's resolution choice;
 * the inconsistency is the bug.
 *
 * Phones used (reserved block +15125556200…6299):
 *   +15125556210 contractor, +15125556211 customer.
 */
import { ApiSession, seedCustomer, seedInvoice } from "./helpers/api";

const CONTRACTOR_PHONE = "+15125556210";
const CUSTOMER_PHONE = "+15125556211";

type LoggedMessage = {
  channel?: string;
  content?: string;
  paperworkId?: string;
};

async function textsFor(s: ApiSession, paperworkId: string): Promise<string[]> {
  const { body } = await s.get("/messages");
  const all: LoggedMessage[] = Array.isArray(body) ? body : body?.items ?? [];
  return all
    .filter((m) => m.channel === "text" && m.paperworkId === paperworkId)
    .map((m) => m.content ?? "");
}

/** Classify an outbound SMS body by unmistakable template markers
 *  (sms-i18n.ts INVOICE_BODY / lang/{en,es}.json paperworkSms.body.ready). */
function smsLangOf(body: string): "es" | "en" | "unknown" {
  const es = /está lista|factura|cotización/i.test(body);
  const en = /is ready|your invoice|quote \+ agreement/i.test(body);
  if (es && !en) return "es";
  if (en && !es) return "en";
  return "unknown";
}

describe("UX-28: one outbound language per contractor across doc types", () => {
  let s: ApiSession;
  let quoteId: string;
  let invoiceId: string;
  let quoteSms: string;
  let invoiceSms: string;

  beforeAll(async () => {
    s = new ApiSession();
    const v = await s.post("/auth/verify", {
      phoneNumber: CONTRACTOR_PHONE,
      code: "000000",
    });
    expect(v.status).toBeLessThan(400);
    // Real name (stays clear of the P-06/UX-26 identity gate) + ES UI.
    const me = await s.put("/me", {
      name: "Rafa Morales",
      email: "ux28.jest@blackhole.postmarkapp.com",
      language: "es",
    });
    expect(me.status).toBeLessThan(400);
    // businessName WITHOUT commsLanguage — the audited account state. Do NOT
    // set commsLanguage here: the whole point is what the two paths do when
    // the stored default is absent and only one of them carries the pick.
    const ident = await s.put("/profile/identity", {
      businessName: "Techos Morales LLC",
    });
    expect(ident.status).toBeLessThan(400);

    const customerId = await seedCustomer(s, {
      name: "María Cliente",
      phoneNumber: CUSTOMER_PHONE,
      email: "ux28.cust@blackhole.postmarkapp.com",
    });

    const q = await s.post("/quotes", {
      customerId,
      summary: "Reparar el techo",
      jobName: "Reparación de techo",
      jobNameByLang: { en: "Roof repair", es: "Reparación de techo" },
      lineItems: [{
        description: "Reparación",
        quantity: 1,
        unit: "ea",
        price: 370000,
      }],
      estimatedTotal: 370000,
    });
    expect(q.status).toBeLessThan(400);
    quoteId = q.body?.id;

    // Assistant leg: conversation → terms wizard ×5 → send with the ES pick.
    const conv = await s.post("/agents/conversations", { quoteId });
    const convId = conv.body?.id ?? conv.body?.conversation?.id;
    expect(convId).toBeTruthy();
    await s.post(`/agents/conversations/${convId}/transition-to-terms`, {});
    const answers: Array<Record<string, unknown>> = [
      {
        stepId: "customer",
        optionId: "pick_existing",
        customer: { id: customerId },
      },
      { stepId: "start_date", optionId: "asap" },
      { stepId: "wraps", optionId: "1_week" },
      { stepId: "payment_terms", optionId: "due_now" },
      { stepId: "warranty", optionId: "none" },
    ];
    for (const a of answers) {
      const r = await s.post("/agents/wizard/answer", {
        conversationId: convId,
        ...a,
      });
      expect(r.status).toBeLessThan(400);
    }
    const send = await s.post(`/agents/conversations/${convId}/send-quote`, {
      quoteId,
      channel: "sms",
      language: "es", // ← exactly what AsstChat passes (previewLang)
    });
    expect(send.status).toBeLessThan(400);

    // Invoice leg: what the assistant invoice flow fires (no language).
    invoiceId = await seedInvoice(s, {
      customerId,
      jobName: "Reparación de techo",
      amount: 370000,
      status: "sent",
    });
    const itext = await s.post(`/invoices/${invoiceId}/text`);
    expect(itext.status).toBeLessThan(400);
    expect(itext.body?.ok).toBe(true);

    const qTexts = await textsFor(s, quoteId);
    const iTexts = await textsFor(s, invoiceId);
    expect(qTexts.length).toBeGreaterThan(0);
    expect(iTexts.length).toBeGreaterThan(0);
    quoteSms = qTexts[qTexts.length - 1];
    invoiceSms = iTexts[iTexts.length - 1];
  }, 30_000);

  it("UX-28: both logged texts are classifiable (anchor)", () => {
    expect(smsLangOf(quoteSms)).not.toBe("unknown");
    expect(smsLangOf(invoiceSms)).not.toBe("unknown");
  });

  it("UX-28: the invoice text speaks the SAME language as the quote/agreement text", () => {
    expect(smsLangOf(invoiceSms)).toBe(smsLangOf(quoteSms));
  });
});
