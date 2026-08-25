/**
 * First-win visibility over the REAL API — merged-world edition of the
 * ux-problems.md UX-02 pins:
 *
 *   UX-02 "The user's first accepted quote is invisible everywhere …" —
 *         after the assistant flow's SMS send + the customer's /q accept,
 *         the job must show on GET /jobs, the value must land in
 *         `wonValueCents`, and the quote card must carry sentAt.
 *
 * The Contract entity is gone: the wizard writes the terms onto the QUOTE
 * (continue_cta payload carries quoteId), the dispatch endpoint is
 * POST /agents/conversations/:id/send-quote, and accepting on /q is the one
 * signature ceremony (it also runs the milestone billing — "due_now" terms
 * yield one full invoice due today).
 *
 * Phones used (block +15125556100-6199):
 *   +15125556110 contractor (assistant-shaped flow)   +15125556160 its customer
 *   +15125556111 contractor (direct/email flow)       +15125556161 its customer
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedCustomer,
  seedQuote,
} from "./helpers/api";

/** Login → wipe → login again: a guaranteed-fresh user for stats. */
async function freshContractor(phone: string): Promise<ApiSession> {
  const pre = await contractor(phone);
  await pre.get("/me/wipe");
  return await contractor(phone);
}

/** Drive the REAL assistant chain to the audit's first-win state and accept.
 *  Returns the ids. Every call is asserted so a harness failure can never be
 *  mistaken for a UX-02 regression. */
async function driveAssistantFirstWin(
  s: ApiSession,
  customerPhone: string,
): Promise<{ quoteId: string; conversationId: string }> {
  // The assistant-drafted quote has NO customerId at draft time — the
  // customer is bound through the wizard's customer step.
  const q = await s.post("/quotes", {
    summary: "Instalación de patio de adoquines",
    jobName: "Patio de adoquines",
    lineItems: [
      {
        description: "Patio de adoquines 20x15",
        quantity: 1,
        unit: "ea",
        price: 370_000,
      },
    ],
    estimatedTotal: 370_000, // the audit's $3,700
    status: "sent",
  });
  expect(q.status).toBeLessThan(400);
  const quoteId = q.body?.id as string;
  expect(quoteId).toBeTruthy();

  const conv = await s.post("/agents/conversations", { quoteId });
  expect(conv.status).toBeLessThan(400);
  const conversationId = conv.body?.id as string;
  expect(conversationId).toBeTruthy();

  const terms = await s.post(
    `/agents/conversations/${conversationId}/transition-to-terms`,
  );
  expect(terms.status).toBeLessThan(400);

  const answer = (
    stepId: string,
    optionId: string,
    extra: Record<string, unknown> = {},
  ) =>
    s.post("/agents/wizard/answer", {
      conversationId,
      stepId,
      optionId,
      ...extra,
    });

  // Phone-only customer → the send smart-defaults to SMS (the audit's
  // "Enviar por texto" — no email on file).
  const cust = await answer("customer", "create_new", {
    customer: {
      create: {
        name: "María Nguyen",
        phoneNumber: customerPhone,
        isBusiness: false,
      },
    },
  });
  expect(cust.status).toBeLessThan(400);
  expect((await answer("start_date", "asap")).status).toBeLessThan(400);
  expect((await answer("wraps", "2_weeks")).status).toBeLessThan(400);
  expect((await answer("payment_terms", "due_now")).status).toBeLessThan(400);
  const last = await answer("warranty", "none");
  expect(last.status).toBeLessThan(400);
  const cta = (last.body?.newMessages ?? []).find(
    (m: { kind?: string }) => m.kind === "continue_cta",
  );
  // The wizard persists the terms ONTO THE QUOTE and the CTA carries its id.
  expect(cta?.payload?.quoteId).toBe(quoteId);

  // The real dispatch: SMS only ("Enviar por texto").
  const sent = await s.post(
    `/agents/conversations/${conversationId}/send-quote`,
    { quoteId, channel: "sms", language: "es" },
  );
  expect(sent.status).toBeLessThan(400);
  expect(
    (sent.body?.newMessages ?? []).some(
      (m: { kind?: string }) => m.kind === "phase_divider",
    ),
  ).toBe(true);

  // María accepts on /q — the one signature ceremony.
  const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
    signature: "María Nguyen",
    name: "María Nguyen",
  });
  expect(accept.status).toBeLessThan(400);
  expect(accept.body?.ok).toBe(true);

  return { quoteId, conversationId };
}

describe("UX-02: the first accepted quote is visible (real assistant flow, SMS send)", () => {
  let s: ApiSession;
  let quoteId: string;

  beforeAll(async () => {
    s = await freshContractor("+15125556110");
    ({ quoteId } = await driveAssistantFirstWin(s, "+15125556160"));
  });

  it("UX-02: GET /jobs lists the freshly won job", async () => {
    const { status, body } = await s.get("/jobs");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0]?.customer?.name).toBe("María Nguyen");
    expect(body[0]?.quote?.id).toBe(quoteId);
  });

  it("UX-02: the dashboard stats carry the accepted $3,700 in the won bucket", async () => {
    const { status, body } = await s.get("/analytics/dashboard");
    expect(status).toBe(200);
    expect(body.quotes.accepted).toBe(1);
    expect(body.awaitingResponse).toBe(0);
    expect(body.wonValueCents).toBe(370_000);
  });

  it("UX-02: the accepted card never claims it was never sent (awaiting-panel truth)", async () => {
    const { status, body } = await s.get("/quotes");
    expect(status).toBe(200);
    const card = (Array.isArray(body) ? body : []).find(
      (c: { id?: string }) => c.id === quoteId,
    );
    expect(card).toBeTruthy();
    expect(card.status).toBe("accepted");
    // The SMS dispatch stamps the send state directly on the quote now
    // (SendQuote flips status/sentAt before dispatching).
    expect(card.sentAt).toBeTruthy();
  });
});

describe("UX-02: with a direct quote→customer link the jobs view works too", () => {
  // The control shape: the same accepted state, but the quote was seeded
  // WITH customerId and emailed directly (no assistant involved).
  let s: ApiSession;
  let quoteId: string;

  beforeAll(async () => {
    s = await freshContractor("+15125556111");
    const customerId = await seedCustomer(s, {
      name: "María Nguyen",
      email: "maria.ux02@blackhole.postmarkapp.com",
      phoneNumber: "+15125556161",
    });
    quoteId = await seedQuote(s, {
      customerId,
      summary: "Instalación de patio de adoquines",
      jobName: "Patio de adoquines",
      lineItems: [
        {
          description: "Patio de adoquines 20x15",
          quantity: 1,
          unit: "ea",
          price: 370_000,
        },
      ],
      estimatedTotal: 370_000,
    });
    const send = await s.post(`/quotes/${quoteId}/email`);
    expect(send.status).toBeLessThan(400);
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      signature: "María Nguyen",
      name: "María Nguyen",
    });
    expect(accept.status).toBeLessThan(400);
  });

  it("UX-02: GET /jobs includes the job", async () => {
    const { status, body } = await s.get("/jobs");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0]?.quote?.id).toBe(quoteId);
    expect(body[0]?.customer?.name).toBe("María Nguyen");
  });

  it("UX-02: the won bucket carries the value in this shape too", async () => {
    const { body } = await s.get("/analytics/dashboard");
    expect(body.quotes.accepted).toBe(1);
    expect(body.wonValueCents).toBe(370_000);
  });
});
