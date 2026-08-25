/**
 * UX-26 over real HTTP: the ASSISTANT's send-quote path must
 * pass the same sender-identity gate as the paperwork controller routes.
 *
 * Finding (ux-problems.md, verbatim fragment):
 *  UX-26 "The assistant's send path bypasses the placeholder-name guard — a
 *         customer received 'Hi Pedro, this is Nuevo.' … route ALL outbound
 *         through one identity gate"
 *
 * Scenario: a SKIP-SETUP session — raw POST /auth/verify only (master OTP;
 * the seeded placeholder "Nuevo usuario", verify-otp/mod.ts:35, survives; no
 * /me name, no email, no business identity) — drives the assistant's REAL
 * deterministic send path end to end:
 *   POST /quotes → POST /agents/conversations {quoteId} →
 *   :id/transition-to-terms → POST /agents/wizard/answer ×5 (customer step
 *   creates "Pedro Cliente" with a phone; the 5-step terms wizard is
 *   terms-wizard-spec/mod.ts) → the final answer persists the terms onto
 *   the quote (handle-wizard-answer finalizeTerms) →
 *   POST /agents/conversations/:id/send-quote {quoteId, channel:"sms"}
 *   (conversations-controller → send-quote/mod.ts
 *   → SendPaperworkSms directly — the guard bypass).
 *
 * Observable: GET /messages — every outbound text is recorded in the comms
 * log (send-paperwork-sms/mod.ts:161-171, channel "text", paperworkId =
 * quote id).
 *
 * Live probe (2026-08-19, this exact flow, phone +15125556200):
 *   send-quote → 200, divider "texted to +15125556201", and the
 *   logged SMS content was:
 *     "Hi Pedro, this is Nuevo.\n\nYour Quote + Agreement for Pintar la sala
 *      is ready: http://localhost:5280/s/OQmJOC\n\n…"
 *   while POST /quotes/:id/text for the SAME account returns the guarded
 *   {ok:false, needsName:true, reason:/name|nombre/i} refusal
 *   (paperwork-email-controller/mod.ts:71-93,185).
 *
 * DESIRED: refusal (needs-name signal surfaced on the divider) or an
 * identity-complete send — the placeholder first name never reaches a
 * customer through ANY path.
 *
 * Phones used (reserved block +15125556200…6299):
 *   +15125556200 contractor (skip-setup), +15125556201 customer.
 */
import { ApiSession } from "./helpers/api";

const CONTRACTOR_PHONE = "+15125556200";
const CUSTOMER_PHONE = "+15125556201";

const PLACEHOLDER = /Nuevo usuario|New user/;

type LoggedMessage = {
  channel?: string;
  content?: string;
  subject?: string;
  toAddress?: string;
  paperworkId?: string;
  paperworkType?: string;
};

async function messagesFor(
  s: ApiSession,
  id: string,
): Promise<LoggedMessage[]> {
  const { body } = await s.get("/messages");
  const all: LoggedMessage[] = Array.isArray(body) ? body : body?.items ?? [];
  return all.filter((m) => JSON.stringify(m).includes(id));
}

/** Poll the comms log briefly (dispatch is awaited server-side, but don't
 *  depend on that staying true). */
async function pollTexts(
  s: ApiSession,
  id: string,
  tries = 8,
  delayMs = 500,
): Promise<LoggedMessage[]> {
  let texts: LoggedMessage[] = [];
  for (let i = 0; i < tries; i++) {
    texts = (await messagesFor(s, id)).filter((m) => m.channel === "text");
    if (texts.length) return texts;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return texts;
}

describe("UX-26: assistant send-quote path passes the sender-identity gate", () => {
  let s: ApiSession;
  let quoteId: string;
  let convId: string;
  let sendBody: unknown;

  beforeAll(async () => {
    // SKIP-SETUP: master-OTP verify ONLY. No PUT /me, no identity — the
    // account keeps the seeded placeholder name.
    s = new ApiSession();
    const v = await s.post("/auth/verify", {
      phoneNumber: CONTRACTOR_PHONE,
      code: "000000",
    });
    expect(v.status).toBeLessThan(400);
    const me = await s.get("/me");
    // Guard the premise: this must still be the placeholder user.
    expect(me.body?.name).toMatch(PLACEHOLDER);

    const q = await s.post("/quotes", {
      summary: "Pintar la sala",
      jobName: "Pintar la sala",
      lineItems: [{
        description: "Pintura",
        quantity: 1,
        unit: "ea",
        price: 45000,
      }],
      estimatedTotal: 45000,
    });
    expect(q.status).toBeLessThan(400);
    quoteId = q.body?.id;
    expect(quoteId).toBeTruthy();

    const conv = await s.post("/agents/conversations", { quoteId });
    expect(conv.status).toBeLessThan(400);
    convId = conv.body?.id ?? conv.body?.conversation?.id;
    expect(convId).toBeTruthy();

    const tt = await s.post(
      `/agents/conversations/${convId}/transition-to-terms`,
      {},
    );
    expect(tt.status).toBeLessThan(400);

    // 5-step terms wizard (terms-wizard-spec/mod.ts): customer,
    // start_date, wraps, payment_terms, warranty. The customer step creates
    // the SMS recipient (phone-only, like the audited flow).
    const answers: Array<Record<string, unknown>> = [
      {
        stepId: "customer",
        optionId: "create_new",
        customer: {
          create: { name: "Pedro Cliente", phoneNumber: CUSTOMER_PHONE },
        },
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

    // The assistant's send CTA — the exact dispatch AsstChat fires
    // (confirmSendQuote → POST :id/send-quote, channel "sms").
    const send = await s.post(`/agents/conversations/${convId}/send-quote`, {
      quoteId,
      channel: "sms",
    });
    expect(send.status).toBeLessThan(400);
    sendBody = send.body;
  }, 30_000);

  it("UX-26: no outbound text for this quote carries the placeholder identity", async () => {
    // Desired contract (mirrors the P-06 email/text precedent): EITHER the
    // dispatch was refused with a machine-readable needs-name signal — the
    // divider carries smsFailureReason and nothing celebrates a send — OR
    // the send went out identity-complete. In BOTH green shapes the comms
    // log contains no placeholder intro for this quote.
    const divider = (sendBody as {
      newMessages?: Array<{ payload?: Record<string, unknown> }>;
    })?.newMessages?.find((m) => m.payload && "channel" in m.payload);
    const refused = !!divider &&
      !divider.payload?.textedTo &&
      /name|nombre/i.test(String(divider.payload?.smsFailureReason ?? ""));

    const texts = await pollTexts(s, quoteId);
    if (refused) {
      // Refusal path: the gate held — nothing placeholder-branded may have
      // been logged as sent.
      for (const m of texts) {
        expect(m.content ?? "").not.toMatch(PLACEHOLDER);
      }
      return;
    }

    // Send path: the SMS reached the log — it must introduce the contractor
    // with a real identity, never the placeholder.
    for (const m of texts) {
      const copy = [m.subject, m.content].filter(Boolean).join("\n");
      expect(copy).not.toMatch(PLACEHOLDER);
      expect(copy).not.toMatch(/\bthis is Nuevo\b/);
      expect(copy).not.toMatch(/\bsoy Nuevo\b/);
      expect(copy).not.toMatch(/\bthis is New\b/);
    }
  });

  it("UX-26: the controller route refuses the same account too (one gate, every path)", async () => {
    // POST /quotes/:id/text carries the P-06 guard
    // (paperwork-email-controller). Same user, same quote, guarded path →
    // needs-name refusal.
    const r = await s.post(`/quotes/${quoteId}/text`);
    const refused = r.status >= 400 || r.body?.ok === false;
    expect(refused).toBe(true);
    expect(JSON.stringify(r.body ?? {})).toMatch(/name|nombre/i);
  });
});
