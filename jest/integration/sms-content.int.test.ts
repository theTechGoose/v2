/**
 * RED (TDD) — outbound SMS content over real HTTP (dev stack on :5280).
 *
 * Problems covered (problems.md, verbatim fragments):
 *  P-27: "SMS sends the wrong-language job name. send-paperwork-sms/mod.ts:305,331
 *         use raw q.jobName while the email path correctly projects jobNameByLang[lang]"
 *  P-30: "'Hola hola,' SMS to unnamed customers. ES signedConfirm.sms.nameFallback =
 *         'hola' fills 'Hola {first}…' → 'Hola hola, tu Cotización + Acuerdo…'"
 *  P-49: "Invoice SMS begins lowercase for unnamed customers — 'tu factura está
 *         lista ($X)…'"
 *  P-50: "Accepted-alert inconsistencies: the with-job subject variant loses the ¡!
 *         and celebratory tone; uses raw jobName (no ByLang)"
 *
 * Scenario: an ES contractor (user.language = "es", identity.commsLanguage = "es")
 * with an UNNAMED customer (POST /customers accepts name: "" — verified) and a
 * quote whose raw jobName ("Kitchen Remodel") deliberately differs from
 * jobNameByLang.es ("Remodelación de cocina"); CreateQuoteDto accepts
 * jobNameByLang/descriptionByLang/summaryByLang directly (paperwork/dto/quote.ts:56-67).
 *
 * Observable: GET /messages — Twilio is silent in dev, every outbound paperwork
 * dispatch is recorded in the communication log (channel "text" for SMS).
 *
 * NOTE FOR THE GREEN AGENT (P-30): SendSignedConfirmation
 * (backend/src/paperwork/domain/coordinators/send-signed-confirmation/mod.ts:276-295)
 * currently fires its customer SMS WITHOUT logging it via LogPaperworkMessage —
 * unlike send-paperwork-sms/mod.ts:160-170 and send-accepted-alert/mod.ts:121-131.
 * The signed-confirm test below asserts the roadmap-p.8 comms trail ("every
 * outbound text is queryable per document"): log the signed-confirm SMS with
 * channel "text" + paperworkId = contract id, AND fix the greeting.
 */
import {
  anonymous,
  contractor,
  seedCustomer,
  seedInvoice,
  seedQuote,
  type ApiSession,
} from "./helpers/api";

const CONTRACTOR_PHONE = "+15125552340"; // reserved block +15125552300…99
const CUSTOMER_PHONE = "+15125552341";

const JOB_EN = "Kitchen Remodel";
const JOB_ES = "Remodelación de cocina";

/** Sentence-initial capital: uppercase letter (incl. Spanish accents/Ñ) or ¡. */
const STARTS_CAPITAL = /^(¡|[A-ZÁÉÍÓÚÜÑ])/u;

type LoggedMessage = {
  channel?: string;
  content?: string;
  subject?: string;
  toAddress?: string;
  paperworkId?: string;
  paperworkType?: string;
};

async function messagesFor(s: ApiSession, id: string): Promise<LoggedMessage[]> {
  const { body } = await s.get("/messages");
  const all: LoggedMessage[] = Array.isArray(body) ? body : body?.items ?? [];
  return all.filter((m) => JSON.stringify(m).includes(id));
}

/** Poll the comms log for a matching entry (the signed-confirmation flow is
 *  fire-and-forget server-side: PDF render + invoice creation run first). */
async function pollForMessage(
  s: ApiSession,
  id: string,
  pred: (m: LoggedMessage) => boolean,
  tries = 20,
  delayMs = 500,
): Promise<LoggedMessage | undefined> {
  for (let i = 0; i < tries; i++) {
    const hit = (await messagesFor(s, id)).find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return undefined;
}

describe("P-27/P-30/P-49/P-50 outbound SMS content — ES contractor, unnamed customer", () => {
  let s: ApiSession;
  let customerId: string;
  let quoteId: string;
  let contractId: string;
  let invoiceId: string;

  beforeAll(async () => {
    s = await contractor(CONTRACTOR_PHONE);
    // Contractor UI language (accepted alerts) AND customer-comms language
    // (quote/contract/invoice texts, signed confirmation) both Spanish.
    await s.put("/me", {
      name: "Marta Contratista",
      email: "sms.es.jest@blackhole.postmarkapp.com",
      language: "es",
    });
    await s.put("/profile/identity", {
      businessName: "MARTA LLC",
      commsLanguage: "es",
    });
    // UNNAMED customer — the API accepts an empty name (verified by probe).
    customerId = await seedCustomer(s, {
      name: "",
      phoneNumber: CUSTOMER_PHONE,
      email: "sms.es.cust@blackhole.postmarkapp.com",
    });
    quoteId = await seedQuote(s, {
      customerId,
      jobName: JOB_EN, // raw jobName is deliberately the EN string
      summary: "Remodel the kitchen",
      jobNameByLang: { en: JOB_EN, es: JOB_ES },
    });
  });

  it("P-27: the quote text projects jobNameByLang[es] — never the raw EN job name", async () => {
    const r = await s.post(`/quotes/${quoteId}/text`);
    expect(r.status).toBeLessThan(400);
    expect(r.body?.ok).toBe(true);

    const texts = (await messagesFor(s, quoteId)).filter((m) => m.channel === "text");
    expect(texts.length).toBeGreaterThan(0);
    const body = texts[texts.length - 1].content ?? "";
    // Desired: exactly like the email path (send-paperwork-email/mod.ts:529),
    // the SMS renders "…para Remodelación de cocina está lista…".
    expect(body).toContain(JOB_ES);
    expect(body).not.toContain(JOB_EN);
  });

  it("P-50: accepting the quote alerts the ES contractor with a celebratory ¡…! subject carrying the ES job name", async () => {
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      signature: "Cliente Firmante",
      name: "Cliente Firmante",
    });
    expect(accept.status).toBeLessThan(400);

    const emails = (await messagesFor(s, quoteId)).filter(
      (m) => m.channel === "email" && typeof m.subject === "string",
    );
    expect(emails.length).toBeGreaterThan(0);
    const subject = emails[emails.length - 1].subject ?? "";
    // Tone parity with the no-job variant ("¡{name} aprobó tu cotización! 🎉"):
    // the with-job subject must keep the ¡…! celebration…
    expect(subject).toMatch(/^¡/);
    expect(subject).toContain("!");
    // …and must carry the contractor-language job name, not the raw EN one.
    expect(subject).toContain(JOB_ES);
    expect(subject).not.toContain(JOB_EN);
  });

  it("P-50: the accepted-alert text carries the ES job name for the ES contractor", async () => {
    // The alert SMS was dispatched during the accept above (awaited server-side).
    const texts = (await messagesFor(s, quoteId)).filter(
      (m) => m.channel === "text" && /acaba de aprobar/i.test(m.content ?? ""),
    );
    expect(texts.length).toBeGreaterThan(0);
    const body = texts[texts.length - 1].content ?? "";
    expect(body).toContain(JOB_ES);
    expect(body).not.toContain(JOB_EN);
  });

  it("P-30: signing the contract sends the unnamed customer a signed-confirm text that never reads 'Hola hola'", async () => {
    const created = await s.post("/contracts", {
      quoteId,
      customerId,
      totalAmount: 250_000,
    });
    expect(created.status).toBeLessThan(400);
    contractId = created.body?.id;
    expect(contractId).toBeTruthy();

    const sign = await anonymous().post(`/contracts/${contractId}/sign`, {
      signature: "Cliente Firmante",
      name: "Cliente Firmante",
    });
    expect(sign.status).toBeLessThan(400);

    // Desired comms trail (roadmap p.8): the customer-facing signed-confirm
    // SMS is recorded like every other outbound text. The SMS body itself
    // links to /c/<contractId>, so matching on the contract id is stable.
    const smsEntry = await pollForMessage(
      s,
      contractId,
      (m) => m.channel === "text",
    );
    expect(smsEntry).toBeDefined(); // RED today: SendSignedConfirmation never logs its SMS
    const body = smsEntry?.content ?? "";
    // The unnamed-customer ES greeting must be natural — never the doubled
    // "Hola hola, tu Cotización + Acuerdo…".
    expect(body).not.toMatch(/hola[\s,]+hola/i);
    expect(body).toMatch(STARTS_CAPITAL);
  }, 25_000);

  it("P-49: the invoice text to the unnamed customer starts with a capital letter", async () => {
    invoiceId = await seedInvoice(s, {
      customerId,
      jobName: JOB_EN,
      amount: 250_000,
    });
    const r = await s.post(`/invoices/${invoiceId}/text`);
    expect(r.status).toBeLessThan(400);
    expect(r.body?.ok).toBe(true);

    const texts = (await messagesFor(s, invoiceId)).filter((m) => m.channel === "text");
    expect(texts.length).toBeGreaterThan(0);
    const body = texts[texts.length - 1].content ?? "";
    expect(body).toMatch(/factura/i); // still the ES invoice body
    // Desired: a real greeting or a capitalized sentence — today the unnamed
    // variant renders "tu factura está lista ($2,500). …" (lowercase start).
    expect(body).toMatch(STARTS_CAPITAL);
  });
});
