/**
 * RED (TDD) — outbound EMAIL content over real HTTP, observed via the
 * communication log (GET /api/messages, rows carry channel/subject/content/
 * paperworkId — see jest/integration/notifications.int.test.ts).
 *
 * P-44 "ES email subject uses English word order — '{businessName} Cotización
 *       para {customerName}…' instead of 'Cotización de {businessName} para…'"
 * P-07 "Accented Spanish job names are mangled in the email hero …
 *       'instalación de baño y cocina' renders as 'InstalacióN De BañO Y Cocina'"
 * P-28 "English/raw dates inside Spanish documents. fmtDate is hardcoded en-US"
 * P-29 "Raw English status enum in the Spanish invoice email — 'Estado: Sent'"
 * P-51 "'3 ea · $350.00 c/u' — the unit fallback 'ea' leaks untranslated into ES emails"
 * P-06 "'Nuevo usuario' / 'New user' leaks into customer-facing email and SMS"
 *
 * Live-probed current bad strings (2026-08-18, dev stack):
 *   quote email subject : "PROBE LLC Cotización para Cliente Probe, Instalación de baño y cocina"
 *   invoice email subject: "Factura #c7b9ff22 — vence August 20, 2026 de Rafa Probe"
 *   skip-user quote subj : "Nuevo usuario Quote for Cliente Skip Dos, Pintura de interiores"
 *   skip-user invoice    : "Invoice #c0c8baab — due August 20, 2026 from Nuevo usuario"
 *   skip-user quote SMS  : "Hi Cliente, this is Nuevo.\n\nYour Quote + Agreement for …"
 *
 * DESIRED OBSERVABLE for body-level assertions: the logged email row exposes
 * the rendered customer-facing copy (a `body`/`htmlBody` field, or `content`
 * carrying the copy). Today `content` is only the stub
 * "quote <id> emailed to <email>" (send-paperwork-email/mod.ts:220-231), so
 * the email BODY is unauditable — the body-anchored its below stay red until
 * the copy is both fixed AND observable. Subject-anchored assertions
 * (P-44/P-28/P-06) are red today on the subject alone.
 */
import {
  ApiSession,
  contractor,
  seedCustomer,
  seedInvoice,
  seedQuote,
} from "./helpers/api";

type LoggedMessage = {
  channel?: string;
  kind?: string;
  subject?: string;
  content?: string;
  body?: string;
  htmlBody?: string;
  toAddress?: string;
  paperworkId?: string;
};

const PLACEHOLDER = /Nuevo usuario|New user/;

async function messagesFor(
  s: ApiSession,
  paperworkId: string,
): Promise<LoggedMessage[]> {
  const { body } = await s.get("/messages");
  const all: LoggedMessage[] = Array.isArray(body) ? body : body?.items ?? [];
  return all.filter((m) => JSON.stringify(m).includes(paperworkId));
}

/** All customer-facing text the log exposes for one outbound message. */
function copyOf(m: LoggedMessage | undefined): string {
  if (!m) return "";
  return [m.subject, m.body, m.htmlBody, m.content].filter(Boolean).join("\n");
}

function emailOf(msgs: LoggedMessage[]): LoggedMessage | undefined {
  return msgs.find((m) => (m.channel ?? m.kind) === "email");
}

describe("outbound email content — ES contractor", () => {
  let s: ApiSession;
  let quoteId: string;
  let invoiceId: string;
  let quoteEmail: LoggedMessage | undefined;
  let invoiceEmail: LoggedMessage | undefined;

  beforeAll(async () => {
    s = await contractor("+15125552201"); // seeds "JEST LLC" identity
    // The helper's loginAs keeps a pre-existing name — for a FRESH phone that
    // is the seeded placeholder "Nuevo usuario". This describe is about i18n,
    // not P-06, so pin a real name explicitly to stay orthogonal to the
    // needs-name enforcement the P-06 describe below tests.
    const named = await s.put("/me", {
      name: "Jest Contractor",
      email: "jest.contractor@blackhole.postmarkapp.com",
      language: "es",
    });
    expect(named.status).toBeLessThan(400);
    // Outbound docs follow the business identity's commsLanguage (subject:
    // send-paperwork-email/mod.ts:521). Set it every run.
    const ident = await s.put("/profile/identity", {
      businessName: "JEST LLC",
      commsLanguage: "es",
    });
    expect(ident.status).toBeLessThan(400);

    const customerId = await seedCustomer(s, {
      name: "Cliente Jest",
      email: "cliente.jest@blackhole.postmarkapp.com",
      phoneNumber: "+15125552202",
    });
    quoteId = await seedQuote(s, {
      customerId,
      summary: "instalación de baño y cocina",
      jobName: "Instalación de baño y cocina",
      description: "Instalación completa de gabinetes y encimeras",
      lineItems: [
        // qty > 1 renders the "{qty} {unit} · {price} c/u" sub-line
        // (send-paperwork-email/mod.ts:653) — today "3 ea · $350.00 c/u".
        {
          description: "Instalación de gabinetes",
          quantity: 3,
          unit: "ea",
          price: 35000,
        },
      ],
      estimatedTotal: 105000,
    });
    const qSend = await s.post(`/quotes/${quoteId}/email`);
    expect(qSend.status).toBeLessThan(400);

    // Standalone invoice (no quote link) → the basic invoice email
    // with the Issued/Due/Status rows (send-paperwork-email/mod.ts:1357-1391).
    invoiceId = await seedInvoice(s, {
      customerId,
      jobName: "Instalación de baño y cocina",
      amount: 105000,
      dueDate: "2026-08-20",
      status: "sent",
    });
    const iSend = await s.post(`/invoices/${invoiceId}/email`);
    expect(iSend.status).toBeLessThan(400);

    quoteEmail = emailOf(await messagesFor(s, quoteId));
    invoiceEmail = emailOf(await messagesFor(s, invoiceId));
  });

  it('P-44 the ES quote subject reads "Cotización de JEST LLC para Cliente Jest…"', () => {
    expect(quoteEmail).toBeDefined();
    const subject = quoteEmail!.subject ?? "";
    // Today (observed live): "JEST LLC Cotización para Cliente Jest, …"
    expect(subject).not.toMatch(/^JEST LLC\s+Cotización/);
    expect(subject.startsWith("Cotización de JEST LLC para Cliente Jest")).toBe(
      true,
    );
  });

  it('P-07 the job name renders "Instalación de Baño y Cocina" — never "InstalacióN De BañO"', () => {
    const copy = copyOf(quoteEmail);
    // Desired hero (Unicode title-case + es stopwords) must be observable in
    // the logged outbound copy. Today red twice over: the hero renders
    // "InstalacióN De BañO Y Cocina" AND the body is not logged at all.
    expect(copy).toContain("Instalación de Baño y Cocina");
    expect(copy).not.toContain("InstalacióN");
    expect(copy).not.toContain("BañO");
  });

  it("P-28 ES invoice email dates are Spanish — no en-US long date, no raw ISO", () => {
    const copy = copyOf(invoiceEmail);
    // Today red on the SUBJECT alone: "Factura #… — vence August 20, 2026 …"
    expect(copy).toContain("agosto de 2026"); // desired: "vence 20 de agosto de 2026"
    expect(copy).not.toContain("August");
    expect(copy).not.toMatch(/vence\s+\d{4}-\d{2}-\d{2}/);
    // No raw ISO date anywhere in the rendered copy (subject/body fields).
    const rendered = [
      invoiceEmail?.subject,
      invoiceEmail?.body,
      invoiceEmail?.htmlBody,
    ]
      .filter(Boolean).join("\n");
    expect(rendered).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });

  it('P-29 ES invoice email status is localized — "Enviado", never raw "Sent"', () => {
    const copy = copyOf(invoiceEmail);
    // The Estado row (send-paperwork-email/mod.ts:1372-1376) currently prints
    // the raw enum. lang/es.json "status.sent" = "Enviado".
    expect(copy).toMatch(/Enviad[oa]/);
    expect(copy).not.toMatch(/\bsent\b/i);
  });

  it('P-51 ES quote email uses the localized unit — "3 c/u", never "3 ea"', () => {
    const copy = copyOf(quoteEmail);
    // lang/es.json "quoteDoc.unitEach" = "c/u" (unused by the email today).
    expect(copy).toMatch(/3\s*c\/u/);
    expect(copy).not.toMatch(/\b3\s+ea\b/);
    expect(copy).not.toMatch(/·\s*ea\b/);
  });
});

describe("outbound email content — P-06 skip-setup user (placeholder name)", () => {
  let s: ApiSession;
  let quoteId: string;
  let invoiceId: string;

  beforeAll(async () => {
    // SKIP-SETUP login: master OTP, then PUT /me WITHOUT a name so the seeded
    // placeholder "Nuevo usuario" (verify-otp/mod.ts:35) survives. No business
    // identity either — exactly the account state a skip user sends from.
    s = new ApiSession();
    const v = await s.post("/auth/verify", {
      phoneNumber: "+15125552210",
      code: "000000",
    });
    expect(v.status).toBeLessThan(400);
    const me = await s.put("/me", {
      email: "skip.jest@blackhole.postmarkapp.com",
      language: "es",
    });
    expect(me.status).toBeLessThan(400);
    const check = await s.get("/me");
    // Guard the premise: this account must still be the placeholder user.
    expect(check.body?.name).toMatch(PLACEHOLDER);

    const customerId = await seedCustomer(s, {
      name: "Cliente Skip",
      email: "cliente.skip@blackhole.postmarkapp.com",
      phoneNumber: "+15125552211",
    });
    quoteId = await seedQuote(s, {
      customerId,
      summary: "pintura de interiores",
      jobName: "Pintura de interiores",
      lineItems: [{
        description: "Pintura",
        quantity: 1,
        unit: "ea",
        price: 50000,
      }],
      estimatedTotal: 50000,
    });
    invoiceId = await seedInvoice(s, {
      customerId,
      amount: 50000,
      dueDate: "2026-08-20",
      status: "sent",
    });
  });

  /** Desired contract for every send below: EITHER the API refuses with a
   *  machine-readable needs-name signal (<<solution>>: collect the missing
   *  info), OR the send goes out with copy that falls back to the business
   *  name — never the placeholder. */
  function expectNeedsNameSignal(body: unknown) {
    expect(JSON.stringify(body ?? {})).toMatch(/name|nombre/i);
  }

  it("P-06 quote EMAIL never exposes the placeholder name", async () => {
    const send = await s.post(`/quotes/${quoteId}/email`);
    const refused = send.status >= 400 || send.body?.ok === false;
    if (refused) {
      expectNeedsNameSignal(send.body);
      return;
    }
    // Today red here: the send result echoes the subject
    // "Nuevo usuario Quote for Cliente Skip, Pintura de interiores".
    expect(JSON.stringify(send.body)).not.toMatch(PLACEHOLDER);
    const msgs = await messagesFor(s, quoteId);
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(copyOf(m)).not.toMatch(PLACEHOLDER);
  });

  it('P-06 quote SMS never introduces the contractor as "Nuevo"', async () => {
    const send = await s.post(`/quotes/${quoteId}/text`);
    const refused = send.status >= 400 || send.body?.ok === false;
    if (refused) {
      expectNeedsNameSignal(send.body);
      return;
    }
    const texts = (await messagesFor(s, quoteId))
      .filter((m) => (m.channel ?? m.kind) === "text");
    expect(texts.length).toBeGreaterThan(0);
    for (const m of texts) {
      const copy = copyOf(m);
      // Today red: "Hi Cliente, this is Nuevo." (first name of the placeholder).
      expect(copy).not.toMatch(PLACEHOLDER);
      expect(copy).not.toMatch(/\bthis is Nuevo\b/);
      expect(copy).not.toMatch(/\bsoy Nuevo\b/);
      expect(copy).not.toContain("Nuevo preparó");
    }
  });

  it('P-06 invoice EMAIL subject never says "from Nuevo usuario"', async () => {
    const send = await s.post(`/invoices/${invoiceId}/email`);
    const refused = send.status >= 400 || send.body?.ok === false;
    if (refused) {
      expectNeedsNameSignal(send.body);
      return;
    }
    // Today red: "Invoice #… — due August 20, 2026 from Nuevo usuario".
    expect(JSON.stringify(send.body)).not.toMatch(PLACEHOLDER);
    const msgs = await messagesFor(s, invoiceId);
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(copyOf(m)).not.toMatch(PLACEHOLDER);
  });
});
