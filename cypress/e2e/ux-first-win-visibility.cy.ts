/// <reference types="cypress" />

/**
 * First-win visibility — live-UI RED specs for ux-problems.md:
 *
 *   UX-02 "The user's first accepted quote is invisible everywhere — the aha
 *         moment reads as 'nothing happened'. … Dashboard 'Trabajos activos: 0'
 *         with empty-state copy 'En cuanto un cliente firme una cotización, el
 *         trabajo aparecerá aquí' … The $3,700 vanishes from every number …
 *         'Cotizaciones esperando firma' panel says 'Aún no hay cotizaciones
 *         enviadas.' … No next-step CTA anywhere: dashboard, /quotes open panel
 *         (only 'Copiar enlace / Ver como cliente'), and /invoices empty state
 *         … all fail to offer 'Crear la factura para María' … the 'Enviar por
 *         texto' button is STILL ACTIVE on the accepted doc."
 *
 * Phones used (block +15125556100-6199):
 *   +15125556120 contractor (dashboard + CTA scan)   +15125556162 its customer
 *   +15125556121 contractor (assistant doc state)    +15125556164 its customer
 *
 * State seeding drives the REAL assistant chain via cy.request — probed live
 * with curl on 2026-08-19; fully deterministic (wizard endpoints, no LLM):
 * POST /quotes (status "sent", NO customerId — the assistant shape) →
 * POST /agents/conversations {quoteId} → POST …/transition-to-terms →
 * POST /agents/wizard/answer ×5 (customer create_new phone-only → start_date
 * asap → wraps 2_weeks → payment_terms due_now → warranty none; the last
 * response carries continue_cta {toPhase:"send", contractId}) →
 * POST …/send-contract {channel:"sms", language:"es"} → POST /quotes/:id/accept.
 * Verified post-accept truth: GET /jobs → [], quotedValueCents 0, the /quotes
 * card {stage:"won", sentAt:null, customerName:null}.
 *
 * Grounded selectors (cited per use below):
 *   KPI cell            .kpi / .kpi__label / .kpi__val   (DashSections.tsx:198-226)
 *   jobs empty copy     activeJobs.empty.text            (DashSections.tsx:281-295;
 *                       lang/es.json "En cuanto un cliente firme…")
 *   awaiting empty copy quotesAwaiting.empty             (DashSections.tsx:371-375;
 *                       "Aún no hay cotizaciones enviadas…")
 *   open-quote panel    [data-cy=quote-open-panel]       (QuotesPage.tsx:160; its only
 *                       actions today: quotesPage.open.copyLink/viewAsClient :179-192)
 *   invoices hero CTA   [data-cy=invoice-new]            (InvoicesPage.tsx:746)
 *   review send button  button.quote-review__send-main   (AsstChat.tsx:5891-5932;
 *                       label asstChat.preview.sendSms "Enviar por texto" when the
 *                       customer is phone-only — smart default AsstChat.tsx:1048-1051;
 *                       the review auto-opens on load via the persisted
 *                       continue_cta toPhase:"send" — AsstChat.tsx:1406-1418, 2450-2491)
 */

const MARIA = "María Nguyen";

interface SeededWin {
  quoteId?: string;
  conversationId?: string;
  contractId?: string;
  customerId?: string;
}

/** login → wipe → login again → skip onboarding → Spanish UI
 *  (same pattern as dashboard-stats-truth.cy.ts). */
function freshSpanishUser(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.request("/api/me/wipe");
  cy.loginAs(phone);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
}

/** Re-login for a subsequent test (cookies are cleared between tests). */
function relogin(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
}

/** Drive the real assistant chain to the audit's accepted first-win state.
 *  Ids land in `out` for the assertions. */
function driveAssistantFirstWin(customerPhone: string, out: SeededWin) {
  cy.request("POST", "/api/quotes", {
    summary: "Instalación de patio de adoquines",
    jobName: "Patio de adoquines",
    lineItems: [
      {
        description: "Patio de adoquines 20x15",
        quantity: 1,
        unit: "ea",
        price: 370000,
      },
    ],
    estimatedTotal: 370000, // the audit's $3,700 (integer cents)
    status: "sent",
  }).then((qr) => {
    out.quoteId = (qr.body as { id: string }).id;
    cy.request("POST", "/api/agents/conversations", { quoteId: out.quoteId })
      .then((cr) => {
        out.conversationId = (cr.body as { id: string }).id;
        cy.request(
          "POST",
          `/api/agents/conversations/${out.conversationId}/transition-to-terms`,
        );
        const answer = (
          stepId: string,
          optionId: string,
          extra: Record<string, unknown> = {},
        ) =>
          cy.request("POST", "/api/agents/wizard/answer", {
            conversationId: out.conversationId,
            stepId,
            optionId,
            ...extra,
          });
        // Phone-only customer → the send smart-defaults to SMS ("Enviar por
        // texto" — the audit's no-email María).
        answer("customer", "create_new", {
          customer: {
            create: { name: MARIA, phoneNumber: customerPhone, isBusiness: false },
          },
        });
        answer("start_date", "asap");
        answer("wraps", "2_weeks");
        answer("payment_terms", "due_now");
        answer("warranty", "none").then((wr) => {
          const msgs =
            (wr.body as {
              newMessages?: Array<
                { kind?: string; payload?: { contractId?: string } }
              >;
            }).newMessages ?? [];
          const cta = msgs.find((m) => m.kind === "continue_cta");
          expect(cta, "wizard completion continue_cta").to.exist;
          out.contractId = cta!.payload!.contractId!;
          cy.request(
            "POST",
            `/api/agents/conversations/${out.conversationId}/send-contract`,
            { contractId: out.contractId, channel: "sms", language: "es" },
          );
          cy.apiAcceptQuote(out.quoteId!, { signature: MARIA, name: MARIA })
            .its("body.ok")
            .should("eq", true);
          cy.request(`/api/agents/conversations/${out.conversationId}`).then(
            (dr) => {
              out.customerId = ((dr.body as {
                conversation?: { customerId?: string };
              }).conversation ?? {}).customerId;
              expect(out.customerId, "conversation customerId").to.be.a(
                "string",
              );
            },
          );
        });
      });
  });
}

// ===========================================================================
// UX-02 — the ES dashboard shows the first win
// ===========================================================================
describe("UX-02 the first accepted quote is visible on the ES dashboard", () => {
  const PHONE = "+15125556120";
  const seeded: SeededWin = {};

  before(() => {
    freshSpanishUser(PHONE);
    driveAssistantFirstWin("+15125556162", seeded);
  });

  beforeEach(() => relogin(PHONE));

  it("UX-02 'Trabajos activos' is not 0 and the 'until a customer signs' promise is gone", () => {
    cy.visit("/dashboard");
    // Anchor: the Spanish KPI strip rendered (islands SSR EN then flip).
    // .kpi/.kpi__val — DashSections.tsx:198-226; label kpis.activeJobs.label.
    cy.contains(".kpi", "Trabajos activos", { timeout: 10000 }).within(() => {
      // RED today: "0" — GET /jobs returns [] for the accepted quote whose
      // customer link lives on the auto-created draft contract.
      cy.get(".kpi__val").should("not.have.text", "0");
    });
    // RED today: the empty-state copy renders right after María signed one
    // (activeJobs.empty.text — DashSections.tsx:283-286).
    cy.contains("En cuanto un cliente firme").should("not.exist");
  });

  it("UX-02 the accepted $3,700 is visible somewhere and the panel stops claiming zero-sent", () => {
    cy.visit("/dashboard");
    cy.contains(".kpi", "Trabajos activos", { timeout: 10000 }).should(
      "be.visible",
    );
    // RED today: the win's value appears NOWHERE on the dashboard
    // (quotedValueCents drops to 0 on accept; no won/por-facturar bucket;
    // no job row). Job rows format via toLocaleString → "$3,700"
    // (DashboardPage.tsx:114-125).
    cy.contains(/\$3[.,]?700/, { timeout: 10000 }).should("be.visible");
    // RED today: the awaiting panel claims no quote was EVER sent — false,
    // one was sent AND accepted (quotesAwaiting.empty — DashSections.tsx:371-375).
    cy.contains("Aún no hay cotizaciones enviadas").should("not.exist");
  });

  it("UX-02 a create-invoice next step referencing the win exists on at least one surface", () => {
    // The audit found NO next-step CTA on any of: dashboard, /quotes open
    // panel (only "Copiar enlace / Ver como cliente" — QuotesPage.tsx:179-192),
    // /invoices empty state (only the generic [data-cy=invoice-new] "Nueva
    // factura" — InvoicesPage.tsx:742-752). Per brief rule 6 we pin the
    // semantically inevitable hook rather than an invented data-cy: an
    // <a>/<button> that BOTH references this win (the quote id, the customer
    // id, or María's name) AND expresses invoice intent (text mentioning
    // "factura" or an href into /invoices). The generic "Nueva factura"
    // button does not qualify — it references nothing.
    const foundOn: string[] = [];
    const scan = (label: string) => {
      cy.document().then((doc) => {
        const quoteId = seeded.quoteId ?? "";
        const customerId = seeded.customerId ?? "";
        const els = Array.from(doc.querySelectorAll("a, button"));
        const hit = els.some((el) => {
          const text = (el.textContent ?? "").trim();
          const href = el.getAttribute("href") ?? "";
          const refsWin = (quoteId && href.includes(quoteId)) ||
            (customerId && href.includes(customerId)) ||
            text.includes("María");
          const invoiceIntent = /factur/i.test(text) ||
            /\/invoices/.test(href);
          return Boolean(refsWin) && invoiceIntent;
        });
        if (hit) foundOn.push(label);
      });
    };

    cy.visit("/dashboard");
    cy.contains(".kpi", "Trabajos activos", { timeout: 10000 }).should(
      "be.visible",
    );
    scan("dashboard");

    cy.then(() => {
      cy.visit(`/quotes?open=${seeded.quoteId}`);
    });
    // Loaded detail panel only — the loading shell carries no data-cy
    // (QuotesPage.tsx:127-133 vs :160).
    cy.get("[data-cy=quote-open-panel]", { timeout: 10000 }).should(
      "be.visible",
    );
    scan("quotes-open-panel");

    cy.visit("/invoices");
    cy.get("[data-cy=invoice-new]", { timeout: 10000 }).should("be.visible");
    scan("invoices");

    // RED today: none of the three surfaces offers "Crear la factura para
    // María" (or any win-referencing invoice CTA).
    cy.then(() => {
      expect(
        foundOn,
        "surfaces offering a create-invoice CTA that references the win",
      ).to.not.be.empty;
    });
  });
});

// ===========================================================================
// UX-02 — the assistant's accepted doc must reflect the acceptance and stop
// offering an active re-send
// ===========================================================================
describe("UX-02 the assistant's accepted doc reflects acceptance and disables re-send", () => {
  const PHONE = "+15125556121";
  const seeded: SeededWin = {};

  before(() => {
    freshSpanishUser(PHONE);
    driveAssistantFirstWin("+15125556164", seeded);
  });

  beforeEach(() => relogin(PHONE));

  // HONESTY NOTE — narrowed on purpose. The audit lists several thread-level
  // gaps (header still "Cotización + Acuerdo enviada para firma", thread badge
  // "Contrato enviado", no acceptance divider, no "Continuar a la factura").
  // The exact copy/placement of that surface is a design choice, so this spec
  // pins only the inevitable core: (1) AFTER the customer accepted, the loaded
  // conversation shows SOME acceptance/approval state (today the contract row
  // stays status "sent" and nothing in the thread ever says it — the header
  // derives from contract.status only, AsstChat.tsx:1204-1223); (2) no ACTIVE
  // "Enviar por texto" remains on the doc (today the persisted continue_cta
  // toPhase:"send" auto-reopens the review with the enabled send button —
  // AsstChat.tsx:1406-1418 + 5891-5932 — inviting duplicate sends).
  it("UX-02 after acceptance the thread shows the accepted state and no active 'Enviar por texto'", () => {
    cy.visit(`/assistant/${seeded.conversationId}`);
    // Anchor: the conversation loaded — the persisted SMS-send divider
    // ("Contrato enviado por mensaje de texto a …", stored with language:"es"
    // by send-contract).
    cy.contains(/enviado por mensaje de texto/i, { timeout: 20000 }).should(
      "be.visible",
    );
    // RED today: nothing on the surface reflects the acceptance. Any honest
    // rendering matches — "aceptada/aceptado/aceptó" (acceptance divider,
    // header asstChat.header.quoteAccepted/contractAccepted), "aprobado/a"
    // (asstChat.statusChip.approved), or "firmado/a". None of today's strings
    // on this page match (header: "…enviada para firma"; chip: "Enviado").
    cy.contains(/aceptad[ao]|aceptó|aprobad[ao]|firmad[ao]/i, {
      timeout: 10000,
    }).should("be.visible");
    // And the accepted doc must not offer a live re-send: the send button
    // (button.quote-review__send-main — AsstChat.tsx:5891) is disabled or
    // gone. Today it renders ACTIVE, labeled "Enviar por texto" (sms default
    // for the phone-only customer, AsstChat.tsx:1048-1051).
    cy.get("button.quote-review__send-main:not(:disabled)").should(
      "not.exist",
    );
    // Belt-and-braces sweep: ANY button reading "Enviar por texto" must be
    // disabled (covers a redesigned send surface that drops the class).
    cy.document().then((doc) => {
      const offenders = Array.from(doc.querySelectorAll("button"))
        .filter((b) => /enviar por texto/i.test(b.textContent ?? ""))
        .filter((b) => !(b as HTMLButtonElement).disabled);
      expect(offenders, "active 'Enviar por texto' buttons on the accepted doc")
        .to.have.length(0);
    });
  });
});

// Module scope — keeps helper names out of the shared global spec scope.
export {};
