/**
 * First-win visibility over the REAL API — RED (TDD) tests for ux-problems.md:
 *
 *   UX-02 "The user's first accepted quote is invisible everywhere … Dashboard
 *         'Trabajos activos: 0' … /api/jobs returns [] for an approved quote
 *         that has an auto-created draft contract … The $3,700 vanishes from
 *         every number … 'Cotizaciones esperando firma' panel says 'Aún no hay
 *         cotizaciones enviadas.' — factually false (one was sent AND
 *         accepted)."
 *
 * Phones used (block +15125556100-6199):
 *   +15125556110 contractor (assistant-shaped flow)   +15125556160 its customer
 *   +15125556111 contractor (direct/email flow)       +15125556161 its customer
 *
 * The audit state is reproduced through the REAL assistant chain — every
 * endpoint below was probed live with curl on 2026-08-19 (stub LLM; the whole
 * chain is deterministic wizard endpoints, no LLM involved):
 *
 *   POST /quotes {status:"sent", estimatedTotal:370000, no customerId}
 *   POST /agents/conversations {quoteId}                      → { id }
 *   POST /agents/conversations/:id/transition-to-terms        → wizard step
 *        "customer" (specId contract-terms-v1)
 *   POST /agents/wizard/answer  customer → create_new {name, phoneNumber}
 *        (phone-only customer — the audit's text-only María); then
 *        start_date→asap, wraps→2_weeks, payment_terms→due_now,
 *        warranty→none → newMessages carries continue_cta
 *        {toPhase:"send", contractId} (the AUTO-CREATED agreement)
 *   POST /agents/conversations/:id/send-contract
 *        {contractId, channel:"sms", language:"es"}           → phase_divider
 *        "Contrato enviado por mensaje de texto a +1512555…" and the SMS is
 *        in GET /messages (channel "text", paperworkId = contractId)
 *   POST /quotes/:id/accept (anonymous)                        → {ok:true}
 *
 * Probe evidence AFTER the accept (curl, 2026-08-19) — today's broken truth:
 *   GET /jobs                → []                      (the win is invisible)
 *   GET /analytics/dashboard → quotes {total:1, sent:0, accepted:1},
 *                              quotedValueCents: 0, awaitingResponse: 0
 *                              (NO field carries the accepted $3,700)
 *   GET /quotes              → [{stage:"won", status:"approved",
 *                               sentAt:null, customerName:null}]
 *                              (the panel's "zero sent" claim + "—" name)
 *   Control probe (same state but quote seeded WITH customerId + emailed):
 *   GET /jobs                → 1 job {status:"awaiting", contract.status:
 *                              "draft"} — so the draft contract itself does
 *                              NOT disqualify; the killer is the missing
 *                              quote→customer link (see the unit file's
 *                              resolveJobCustomerId contract + wiring sites).
 *
 * New REST contract pinned here (green agent): GET /analytics/dashboard gains
 * `wonValueCents` — INTEGER cents of won (accepted/signed), non-sample quotes;
 * the "ganado / por facturar" money. Named symmetrically to the existing
 * `quotedValueCents` (backend/src/analytics/dto/dashboard-stats.ts:75-77).
 */
import { anonymous, contractor, seedCustomer, seedQuote, type ApiSession } from "./helpers/api";

/** Login → wipe → login again: a guaranteed-fresh user for stats. */
async function freshContractor(phone: string): Promise<ApiSession> {
  const pre = await contractor(phone);
  await pre.get("/me/wipe");
  return await contractor(phone);
}

/** Drive the REAL assistant chain to the audit's first-win state and accept.
 *  Returns the ids. Every call is asserted so a harness failure can never be
 *  mistaken for the UX-02 red. */
async function driveAssistantFirstWin(
  s: ApiSession,
  customerPhone: string,
): Promise<{ quoteId: string; conversationId: string; contractId: string }> {
  // The assistant-drafted quote has NO customerId — the customer is bound to
  // the conversation + contract only (bind-conversation-customer/mod.ts:43-49).
  const q = await s.post("/quotes", {
    summary: "Instalación de patio de adoquines",
    jobName: "Patio de adoquines",
    lineItems: [
      { description: "Patio de adoquines 20x15", quantity: 1, unit: "ea", price: 370_000 },
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
  ) => s.post("/agents/wizard/answer", { conversationId, stepId, optionId, ...extra });

  // Phone-only customer → the send smart-defaults to SMS (the audit's
  // "Enviar por texto" — no email on file).
  const cust = await answer("customer", "create_new", {
    customer: {
      create: { name: "María Nguyen", phoneNumber: customerPhone, isBusiness: false },
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
  const contractId = cta?.payload?.contractId as string;
  expect(contractId).toBeTruthy(); // the AUTO-CREATED draft agreement

  // The real dispatch: SMS only ("Enviar por texto").
  const sent = await s.post(
    `/agents/conversations/${conversationId}/send-contract`,
    { contractId, channel: "sms", language: "es" },
  );
  expect(sent.status).toBeLessThan(400);
  expect(
    (sent.body?.newMessages ?? []).some(
      (m: { kind?: string }) => m.kind === "phase_divider",
    ),
  ).toBe(true);

  // María accepts on /q.
  const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
    signature: "María Nguyen",
    name: "María Nguyen",
  });
  expect(accept.status).toBeLessThan(400);
  expect(accept.body?.ok).toBe(true);

  return { quoteId, conversationId, contractId };
}

describe("UX-02: the first accepted quote is visible (real assistant flow, SMS send)", () => {
  let s: ApiSession;
  let quoteId: string;

  beforeAll(async () => {
    s = await freshContractor("+15125556110");
    ({ quoteId } = await driveAssistantFirstWin(s, "+15125556160"));
  });

  it("UX-02: GET /jobs lists the freshly won job — the draft auto-contract must not hide it", async () => {
    const { status, body } = await s.get("/jobs");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    // Today: [] — list-active-jobs resolves the customer from
    // quote.customerId only (mod.ts:97-98) and the assistant's SMS path never
    // set it, so the just-won job vanishes and the dashboard shows
    // "Trabajos activos: 0" over "En cuanto un cliente firme…".
    expect(body.length).toBe(1);
    expect(body[0]?.customer?.name).toBe("María Nguyen");
    expect(body[0]?.quote?.id).toBe(quoteId);
  });

  it("UX-02: the dashboard stats carry the accepted $3,700 in a won/receivable bucket", async () => {
    const { status, body } = await s.get("/analytics/dashboard");
    expect(status).toBe(200);
    // Guards (true today — the acceptance itself IS recorded):
    expect(body.quotes.accepted).toBe(1);
    expect(body.awaitingResponse).toBe(0);
    // The red: today NO field carries the win's value — quotedValueCents
    // drops to 0 the moment the quote leaves "sent" and nothing picks the
    // $3,700 up ("Por cobrar $0"; the win's value appears nowhere).
    expect(body.wonValueCents).toBe(370_000);
  });

  it("UX-02: the accepted card never claims it was never sent (awaiting-panel truth)", async () => {
    const { status, body } = await s.get("/quotes");
    expect(status).toBe(200);
    const card = (Array.isArray(body) ? body : []).find(
      (c: { id?: string }) => c.id === quoteId,
    );
    expect(card).toBeTruthy();
    // Guard (true today):
    expect(card.status).toBe("approved");
    // The red: the doc WAS dispatched (contract SMS logged to /messages,
    // channel "text") and the customer demonstrably received it — they
    // accepted. Yet sentAt is null because the SMS path skips the stamp
    // (send-contract/mod.ts:116-130 gates the quote backfill on wantEmail),
    // so the dashboard's awaiting panel reads "Aún no hay cotizaciones
    // enviadas. Prepara una en el asistente." — factually false. Stamp the
    // send state on the SMS dispatch (or at latest on accept).
    expect(card.sentAt).toBeTruthy();
  });
});

describe("UX-02: [contract-pin] with a direct quote→customer link the jobs view already works", () => {
  // GREEN on purpose (probed 2026-08-19). This pins the control shape: the
  // same accepted-with-draft-contract state, but the quote itself carries
  // customerId (seeded via POST /quotes + /quotes/:id/email). It proves the
  // draft agreement does NOT disqualify the win — so the green agent's fix
  // must target the customer-link resolution, and can never regress this.
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
        { description: "Patio de adoquines 20x15", quantity: 1, unit: "ea", price: 370_000 },
      ],
      estimatedTotal: 370_000,
    });
    const send = await s.post(`/quotes/${quoteId}/email`);
    expect(send.status).toBeLessThan(400);
    const contract = await s.post("/contracts", {
      quoteId,
      customerId,
      status: "draft",
      totalAmount: 370_000,
    });
    expect(contract.status).toBeLessThan(400);
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      signature: "María Nguyen",
      name: "María Nguyen",
    });
    expect(accept.status).toBeLessThan(400);
  });

  it("UX-02: [contract-pin] GET /jobs includes the job even though a draft contract exists", async () => {
    const { status, body } = await s.get("/jobs");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0]?.quote?.id).toBe(quoteId);
    expect(body[0]?.contract?.status).toBe("draft");
    expect(body[0]?.customer?.name).toBe("María Nguyen");
  });

  it("UX-02: the won bucket carries the value in this shape too", async () => {
    // Same red as the assistant shape: wonValueCents must exist regardless of
    // how the win happened.
    const { body } = await s.get("/analytics/dashboard");
    expect(body.quotes.accepted).toBe(1);
    expect(body.wonValueCents).toBe(370_000);
  });
});
