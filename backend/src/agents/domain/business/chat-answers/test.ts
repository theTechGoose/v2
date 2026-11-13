/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — the assistant's server-written
 * answers: the three price tiers for a pricing question, and where the bill
 * stands for a "send him the invoice" ask. Pure: no I/O, no model.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { billingReply, inquiryReply, owedReply, pricingReply } from "./mod.ts";

const TIERS = [
  {
    tier: "competitive" as const,
    label: "Competitive",
    priceCents: 180_000,
    rationale: "Straightforward swap, priced to win",
  },
  {
    tier: "market" as const,
    label: "Market",
    priceCents: 240_000,
    rationale: "Typical 200A panel swap in your area",
  },
  {
    tier: "premium" as const,
    label: "Premium",
    priceCents: 310_050,
    rationale: "",
  },
];

Deno.test("REQ-368 M30 + REQ-388 M23 pricingReply: names the job and place, lists the three tiers with their prices, and offers the draft (never writes one)", () => {
  const text = pricingReply("en", {
    job: "panel swap 200a",
    where: "Austin, TX",
    options: TIERS,
    basis: "labor_and_materials",
    offerDraft: { tier: "Market", amountCents: 240_000 },
  });
  assertStringIncludes(text, "panel swap 200a");
  assertStringIncludes(text, "Austin, TX");
  assertStringIncludes(
    text,
    "Competitive: $1,800 — Straightforward swap, priced to win",
  );
  assertStringIncludes(
    text,
    "Market: $2,400 — Typical 200A panel swap in your area",
  );
  // no rationale → no dangling dash; cents kept when there are any
  assertStringIncludes(text, "Premium: $3,100.50\n");
  assertStringIncludes(text, "labor and materials");
  assertStringIncludes(text, "Market price");
  assertStringIncludes(text, "Draft a quote");
  assert(!/I drafted/i.test(text), text);
  assert(!/can'?t|cannot|unable/i.test(text), text);
  // plain text, one tier per line — no markdown
  assert(!/[*#`]/.test(text), text);
});

Deno.test("REQ-368 M30 pricingReply: with a draft already open it offers to update it instead of claiming a new draft", () => {
  const text = pricingReply("en", {
    job: "Panel swap",
    options: TIERS,
    basis: "labor_and_materials",
  });
  assert(!text.includes("in undefined"), text);
  assert(!/drafted/i.test(text), text);
  assertStringIncludes(text, "update the quote");
});

Deno.test("REQ-368 M30 pricingReply: Spanish", () => {
  const text = pricingReply("es", {
    job: "cambiar un panel de 200A",
    where: "Austin, TX",
    options: TIERS.map((o, i) => ({
      ...o,
      label: ["Competitivo", "De mercado", "Premium"][i],
    })),
    basis: "labor_and_materials",
    offerDraft: { tier: "De mercado", amountCents: 240_000 },
  });
  assertStringIncludes(text, "cambiar un panel de 200A");
  assertStringIncludes(text, "Competitivo: $1,800");
  assertStringIncludes(text, "mano de obra y materiales");
  assertStringIncludes(text, "De mercado");
});

// ---------------------------------------------------------------------------
// M32 — pair 1: $3,200 repaint, 50/50, John signed; signing auto-created
// INV-001 ($1,600 deposit, sent) and INV-002 ($1,600 balance, scheduled).
// ---------------------------------------------------------------------------

const SIGNED = {
  id: "q-1",
  status: "accepted",
  acceptedAt: "2026-11-12T05:35:18Z",
  customerSnapshot: { name: "John Miller" },
};
const DEPOSIT = {
  id: "inv-1",
  number: "INV-001",
  quoteId: "q-1",
  status: "sent",
  amount: 160_000,
  dueDate: "2026-11-19",
  installmentIndex: 1,
  installmentTotal: 2,
  createdAt: "2026-11-12T05:35:19Z",
};
const BALANCE = {
  id: "inv-2",
  number: "INV-002",
  quoteId: "q-1",
  status: "scheduled",
  amount: 160_000,
  dueDate: "2026-12-03",
  scheduledFor: "2026-11-26",
  installmentIndex: 2,
  installmentTotal: 2,
  createdAt: "2026-11-12T05:35:19Z",
};

Deno.test("REQ-368 M32 billingReply: signed with the deposit invoice already out — says so, names it, and shows it", () => {
  const r = billingReply("en", SIGNED, [BALANCE, DEPOSIT]);
  assertStringIncludes(r.text, "John Miller");
  assertStringIncludes(r.text, "$1,600");
  assertStringIncludes(r.text, "deposit");
  assertStringIncludes(r.text, "INV-001");
  assertStringIncludes(r.text, "Nov 19");
  // the balance is scheduled — the reply says when it goes out
  assertStringIncludes(r.text, "INV-002");
  assertStringIncludes(r.text, "Nov 26");
  assertEquals(r.offerInvoiceCta, false);
  assertEquals(r.invoice?.id, "inv-1");
  assertEquals(r.invoice?.status, "sent");
  assertEquals(r.invoice?.amountCents, 160_000);
  assertEquals(r.invoice?.dueDate, "2026-11-19");
  assertStringIncludes(r.invoice!.title, "INV-001");
  assertStringIncludes(r.invoice!.line, "Deposit");
});

Deno.test("REQ-368 M32 billingReply: Spanish", () => {
  const r = billingReply("es", SIGNED, [DEPOSIT, BALANCE]);
  assertStringIncludes(r.text, "John Miller");
  assertStringIncludes(r.text, "anticipo");
  assertStringIncludes(r.text, "INV-001");
  assertStringIncludes(r.text, "19 nov");
  assertStringIncludes(r.invoice!.line, "Anticipo");
});

Deno.test("REQ-368 M32 billingReply: the deposit paid and the balance sent → the balance is the one shown", () => {
  const r = billingReply("en", SIGNED, [
    { ...DEPOSIT, status: "paid" },
    { ...BALANCE, status: "sent", scheduledFor: undefined },
  ]);
  assertEquals(r.invoice?.id, "inv-2");
  assertStringIncludes(r.text, "INV-002");
});

Deno.test("REQ-368 M32 billingReply: everything paid → says it is paid", () => {
  const r = billingReply("en", SIGNED, [
    { ...DEPOSIT, status: "paid" },
    { ...BALANCE, status: "paid" },
  ]);
  assertStringIncludes(r.text.toLowerCase(), "paid");
  assertEquals(r.offerInvoiceCta, false);
});

Deno.test("REQ-368 M32 billingReply: signed but nothing billed yet → offers the invoice CTA, shows no card", () => {
  const r = billingReply("en", SIGNED, []);
  assertEquals(r.offerInvoiceCta, true);
  assertEquals(r.invoice, undefined);
  assertStringIncludes(r.text, "John Miller");
});

Deno.test("REQ-368 M32 billingReply: not signed yet / not sent yet / declined — the honest state, nothing to show or send", () => {
  for (
    const [quote, needle] of [
      [
        { id: "q", status: "sent", customerSnapshot: { name: "John Miller" } },
        "hasn't signed",
      ],
      [{ id: "q", status: "viewed" }, "hasn't signed"],
      [
        { id: "q", status: "draft", lockedAt: "2026-11-12T05:00:00Z" },
        "hasn't been sent",
      ],
      [{ id: "q", status: "lost" }, "declined"],
    ] as const
  ) {
    const r = billingReply("en", quote, []);
    assertStringIncludes(r.text, needle, quote.status);
    assertEquals(r.offerInvoiceCta, false, quote.status);
    assertEquals(r.invoice, undefined, quote.status);
  }
  // no customer on file → a generic name, never "undefined"
  const r = billingReply("en", { id: "q", status: "viewed" }, []);
  assert(!r.text.includes("undefined"), r.text);
});

// ---------------------------------------------------------------------------
// REQ-388 (demo-loop cycle 2, M23 + M19, run r561db6d4)
// ---------------------------------------------------------------------------

Deno.test("REQ-388 M23 pricingReply: pair 7's two questions — each job its own block, 'to <action>' reads as English, one offer at most", () => {
  const text = pricingReply("en", {
    job: "move a shower drain 18 inches on a slab foundation",
    action: true,
    where: "Austin, TX",
    options: TIERS,
    basis: "labor_and_materials",
    more: [{ job: "piso radiante en un baño de 8x10", options: TIERS }],
  });
  assertStringIncludes(
    text,
    "Here's what I'd charge to move a shower drain 18 inches on a slab foundation in Austin, TX:",
  );
  assertStringIncludes(
    text,
    "Here's what I'd charge for piso radiante en un baño de 8x10 in Austin, TX:",
  );
  assertEquals(text.match(/Market: \$2,400/g)?.length, 2, text);
  assert(!/for move/.test(text), text);
  // no offer asked for → no offer made, and never "I drafted"
  assert(!/Draft a quote|I drafted/i.test(text), text);
});

// Pair 2: Ana López signed Q-001 ($400, "Pago al finalizar"). REQ-316 bills a
// pay-after-completion job after it: signing scheduled INV-001 for Nov 26 and
// sent nothing (/invoices: "Queda por facturar $400 · 1 factura programada").
const ANA_QUOTE = {
  id: "q-ana",
  number: "Q-001",
  status: "accepted",
  acceptedAt: "2026-11-12T09:12:00Z",
  estimatedTotal: 40_000,
  jobName: "Mantenimiento de jardín",
  customerSnapshot: { name: "Ana López" },
};
const ANA_INVOICE = {
  id: "inv-ana",
  number: "INV-001",
  quoteId: "q-ana",
  status: "scheduled",
  amount: 40_000,
  scheduledFor: "2026-11-26",
  dueDate: "2026-12-11",
  installmentIndex: 1,
  installmentTotal: 1,
  createdAt: "2026-11-12T09:12:01Z",
};

Deno.test("REQ-388 M19 owedReply: pair 2 — Ana owes $400, billed after the job: INV-001 is scheduled for Nov 26, nothing went out — all in Spanish", () => {
  const r = owedReply("es", {
    name: "Ana López",
    quotes: [ANA_QUOTE],
    invoices: [ANA_INVOICE],
    today: "2026-11-12",
  });
  // REQ-474 (cycle 3, M17): owed NOW is the open receivable (the Clientes
  // card's rule); a scheduled bill is still to be billed
  assertEquals(r.owedCents, 0);
  assertEquals(r.upcomingCents, 40_000);
  assertStringIncludes(
    r.text,
    "Ana López todavía no te debe nada — $400 aún no se ha facturado",
  );
  assertStringIncludes(r.text, "INV-001");
  assertStringIncludes(r.text, "programada");
  assertStringIncludes(r.text, "26 nov");
  assertStringIncludes(r.text, "11 dic"); // when it is due — "¿cuándo me va a pagar?"
  assert(!/invoice/i.test(r.text), `English 'invoice' in: ${r.text}`);
  assert(
    !/se envi[oó]|ya sali[oó]/i.test(r.text),
    `claims it was sent: ${r.text}`,
  );
});

Deno.test("REQ-388 M19 owedReply: pair 1 — the $1,600 deposit is out (due Nov 19), the $1,600 balance is scheduled (Nov 26): John owes $3,200", () => {
  const r = owedReply("en", {
    name: "John Miller",
    quotes: [{ ...SIGNED, number: "Q-001", estimatedTotal: 320_000 }],
    invoices: [BALANCE, DEPOSIT],
    today: "2026-11-12",
  });
  // REQ-474: $1,600 is out (owed now), $1,600 is scheduled (not billed yet)
  assertEquals(r.owedCents, 160_000);
  assertEquals(r.upcomingCents, 160_000);
  assertStringIncludes(
    r.text,
    "John Miller owes you $1,600 now; $1,600 more isn't billed yet.",
  );
  assertStringIncludes(r.text, "$1,600 invoice (INV-001) is out");
  assertStringIncludes(r.text, "Nov 19");
  assertStringIncludes(r.text, "INV-002");
  assertStringIncludes(r.text, "Nov 26");
  // the invoice that is out comes before the one still scheduled
  assert(r.text.indexOf("INV-001") < r.text.indexOf("INV-002"), r.text);
});

Deno.test("REQ-388 M19 owedReply: past due, paid up, signed but not invoiced, and nothing signed yet", () => {
  const overdue = owedReply("en", {
    name: "John Miller",
    quotes: [{ ...SIGNED, estimatedTotal: 320_000 }],
    invoices: [DEPOSIT, BALANCE],
    today: "2026-11-25",
  });
  assertStringIncludes(overdue.text, "overdue");
  assertStringIncludes(overdue.text, "Nov 19");

  const paid = owedReply("en", {
    name: "John Miller",
    quotes: [{ ...SIGNED, estimatedTotal: 320_000 }],
    invoices: [{ ...DEPOSIT, status: "paid" }, { ...BALANCE, status: "paid" }],
  });
  assertEquals(paid.owedCents, 0);
  assertStringIncludes(paid.text, "paid up");

  const unbilled = owedReply("en", {
    name: "John Miller",
    quotes: [{ ...SIGNED, number: "Q-001", estimatedTotal: 320_000 }],
    invoices: [],
  });
  assertEquals(unbilled.owedCents, 0);
  assertEquals(unbilled.upcomingCents, 320_000);
  assertStringIncludes(
    unbilled.text,
    "doesn't owe you anything yet — $3,200 isn't billed yet",
  );
  assertStringIncludes(unbilled.text, "$3,200 of Q-001 isn't billed yet");

  const unsigned = owedReply("en", {
    name: "John Miller",
    quotes: [
      { id: "q-2", number: "Q-002", status: "sent", estimatedTotal: 120_000 },
      { id: "q-3", number: "Q-003", status: "draft", estimatedTotal: 50_000 },
    ],
    invoices: [],
  });
  assertEquals(unsigned.owedCents, 0);
  assertStringIncludes(unsigned.text, "doesn't owe you anything");
  assertStringIncludes(unsigned.text, "Q-002");
  assertStringIncludes(unsigned.text, "signature");
  assertStringIncludes(unsigned.text, "Q-003");
  assertStringIncludes(unsigned.text, "hasn't been sent");
  // void invoices and declined quotes count for nothing
  const voided = owedReply("en", {
    name: "John Miller",
    quotes: [{ id: "q-4", status: "lost", estimatedTotal: 90_000 }],
    invoices: [{ ...DEPOSIT, quoteId: "q-4", status: "void" }],
  });
  assertEquals(voided.owedCents, 0);
  assert(!voided.text.includes("undefined"), voided.text);
});

Deno.test("REQ-388 M19 billingReply: a pay-after-completion quote — signed, its only invoice scheduled — says nothing is billed yet and when it goes out, with no 'Continue to invoice' (it would bill the job twice)", () => {
  const r = billingReply("es", ANA_QUOTE, [ANA_INVOICE]);
  assertStringIncludes(r.text, "Ana López");
  assertStringIncludes(r.text, "INV-001");
  assertStringIncludes(r.text, "26 nov");
  assert(!/se envi[oó]/i.test(r.text), r.text);
  assertEquals(r.offerInvoiceCta, false);
  // REQ-583 AMENDMENT (demo-loop cycle 4, M2): the scheduled invoice is now
  // shown as its card with "Send now" (pair 3/9 had no way to send it from
  // the chat) — still no "Continue to invoice", still nothing sent.
  assertEquals(r.invoice?.id, "inv-ana");
  assertEquals(r.invoice?.status, "scheduled");
  assertEquals(r.invoice?.offerSend, true);

  const en = billingReply("en", ANA_QUOTE, [ANA_INVOICE]);
  assertStringIncludes(en.text, "nothing is billed yet");
  assertStringIncludes(en.text, "Nov 26");
  assert(!/went out/i.test(en.text), en.text);
});

Deno.test("REQ-388 M19 billingReply: a scheduled pay-after-completion invoice the contractor sent later was not sent by signing", () => {
  const r = billingReply("en", ANA_QUOTE, [{ ...ANA_INVOICE, status: "sent" }]);
  assertStringIncludes(r.text, "INV-001");
  assert(!/went out automatically|signed, so/i.test(r.text), r.text);
  assertEquals(r.invoice?.id, "inv-ana");
});

// ---------------------------------------------------------------------------
// REQ-474 (demo-loop cycle 3, M17) — owed now vs still to bill
// ---------------------------------------------------------------------------

const ANA_PEREZ_QUOTE = {
  id: "q-ap",
  number: "Q-001",
  status: "accepted",
  acceptedAt: "2026-11-12T09:00:00Z",
  estimatedTotal: 18_000,
  customerSnapshot: { name: "Ana Pérez" },
};
const ANA_PEREZ_SCHEDULED = {
  id: "inv-ap-1",
  number: "INV-001",
  quoteId: "q-ap",
  status: "scheduled",
  amount: 18_000,
  scheduledFor: "2026-11-20",
  dueDate: "2026-11-20",
};
/** the demo's standalone "Bill a client directly" invoice: no quoteId */
const ANA_PEREZ_DIRECT = {
  id: "inv-ap-2",
  number: "INV-002",
  status: "sent",
  amount: 18_000,
  dueDate: "2026-12-12",
};

Deno.test("REQ-474 M17 owedReply: the demo's books — INV-001 $180 scheduled on Q-001 plus a direct INV-002 $180 sent — say $180 owed now and $180 not billed yet, never $360 owed (the Clientes card says $180)", () => {
  const r = owedReply("es", {
    name: "Ana Pérez",
    quotes: [ANA_PEREZ_QUOTE],
    invoices: [ANA_PEREZ_SCHEDULED, ANA_PEREZ_DIRECT],
    today: "2026-11-12",
  });
  assertEquals(r.owedCents, 18_000, "owed now = the open receivable");
  assertEquals(r.upcomingCents, 18_000, "the scheduled INV-001");
  assertStringIncludes(
    r.text,
    "Ana Pérez te debe $180 ahora; $180 más aún no se ha facturado.",
  );
  assert(!r.text.includes("$360"), r.text);
  assertStringIncludes(r.text, "INV-002");
  assertStringIncludes(r.text, "INV-001");

  const en = owedReply("en", {
    name: "Ana Pérez",
    quotes: [ANA_PEREZ_QUOTE],
    invoices: [ANA_PEREZ_SCHEDULED, ANA_PEREZ_DIRECT],
    today: "2026-11-12",
  });
  assertStringIncludes(
    en.text,
    "Ana Pérez owes you $180 now; $180 more isn't billed yet.",
  );
});

Deno.test("REQ-474 M17 owedReply: owed now is what is still owed on an open invoice (the card's receivableBalanceCents) — a $50 part payment leaves $130; a paid or void one owes nothing", () => {
  const part = owedReply("en", {
    name: "Ana Pérez",
    quotes: [],
    invoices: [{ ...ANA_PEREZ_DIRECT, paidCents: 5_000 }],
  });
  assertEquals(part.owedCents, 13_000);
  assertEquals(part.upcomingCents, 0);
  assertStringIncludes(part.text, "Ana Pérez owes you $130.");

  const paid = owedReply("en", {
    name: "Ana Pérez",
    quotes: [],
    invoices: [{ ...ANA_PEREZ_DIRECT, paidAt: "2026-11-12T10:00:00Z" }],
  });
  assertEquals(paid.owedCents, 0);
});

// ---------------------------------------------------------------------------
// REQ-583 (demo-loop cycle 4, M2): an invoice not sent yet is shown as its
// card with "Send now". Pair 3 ("Invoice Maria for the deep clean") and pair 9
// ("…mándale la factura") got "it's scheduled for Nov 19" and nothing to
// press; pair 1, after the deposit was paid, heard nothing about the balance.
// ---------------------------------------------------------------------------

Deno.test("REQ-583 M2 billingReply: pay on completion — the scheduled invoice is the card, with Send now, and nothing is billed by asking", () => {
  const r = billingReply("en", ANA_QUOTE, [ANA_INVOICE]);
  assertStringIncludes(r.text, "nothing is billed yet");
  assertStringIncludes(r.text, "Nov 26");
  assertEquals(r.offerInvoiceCta, false);
  assertEquals(r.invoice?.id, "inv-ana");
  assertEquals(r.invoice?.number, "INV-001");
  assertEquals(r.invoice?.status, "scheduled");
  assertEquals(r.invoice?.offerSend, true);
  assertEquals(r.invoice?.amountCents, 40_000);
});

Deno.test("REQ-583 M2 billingReply: the deposit paid, the balance scheduled — says when the balance goes out, and shows it with Send now", () => {
  const r = billingReply("en", SIGNED, [
    { ...DEPOSIT, status: "paid" },
    BALANCE,
  ]);
  assertStringIncludes(r.text, "paid");
  assertStringIncludes(r.text, "INV-002");
  assertStringIncludes(r.text, "Nov 26");
  assertEquals(r.invoice?.id, "inv-2");
  assertEquals(r.invoice?.status, "scheduled");
  assertEquals(r.invoice?.offerSend, true);
  const es = billingReply("es", SIGNED, [
    { ...DEPOSIT, status: "paid" },
    BALANCE,
  ]);
  assertStringIncludes(es.text, "INV-002");
  assertStringIncludes(es.text, "26 nov");
});

Deno.test("REQ-583 M2 billingReply: a drafted invoice is shown with Send now; a sent one never offers it again", () => {
  const drafted = billingReply("en", SIGNED, [{ ...DEPOSIT, status: "draft" }]);
  assertEquals(drafted.invoice?.id, "inv-1");
  assertEquals(drafted.invoice?.status, "draft");
  assertEquals(drafted.invoice?.offerSend, true);
  const out = billingReply("en", SIGNED, [DEPOSIT, BALANCE]);
  assertEquals(out.invoice?.id, "inv-1");
  assertEquals(out.invoice?.offerSend, undefined);
});

// ---------------------------------------------------------------------------
// REQ-701 (demo-loop cycle 5, M21) — "¿dónde le contesto?" answered from the
// stored questions: who asked what, on which quote, how to reach them, and
// where in the app to answer (the quote's "Questions from the client").
// ---------------------------------------------------------------------------

const LINDA_Q = {
  quoteId: "q-linda",
  quoteNumber: "Q-001",
  job: "Retiro de muebles",
  name: "Linda Morales",
  question:
    "¿Pueden venir el sábado en la mañana? ¿Se llevan también un colchón?",
  contactBack: "linda.morales@example.com",
  at: "2026-11-12T19:02:11.000Z",
};

Deno.test("REQ-701 M21 inquiryReply (es): pair 9 — Linda's question, the quote, how to reach her and where to answer, with a link to that quote", () => {
  const r = inquiryReply("es", [LINDA_Q]);
  assertStringIncludes(
    r.text,
    "Linda Morales preguntó en Q-001 (Retiro de muebles)",
  );
  assertStringIncludes(r.text, "12 nov");
  assertStringIncludes(
    r.text,
    "“¿Pueden venir el sábado en la mañana? ¿Se llevan también un colchón?”",
  );
  assertStringIncludes(r.text, "Contáctalos: linda.morales@example.com");
  assertStringIncludes(r.text, "Preguntas del cliente");
  assertStringIncludes(r.text, "Responder por texto");
  assert(!/factura|INV-/i.test(r.text), r.text);
  assertEquals(r.link, { quoteId: "q-linda", quoteNumber: "Q-001" });
});

Deno.test("REQ-701 M21 inquiryReply (en): same answer in English; no contact-back line when the client gave none", () => {
  const r = inquiryReply("en", [{
    ...LINDA_Q,
    job: "Furniture removal",
    question: "Can you come Saturday morning?",
    contactBack: undefined,
  }]);
  assertStringIncludes(
    r.text,
    "Linda Morales asked on Q-001 (Furniture removal)",
  );
  assertStringIncludes(r.text, "Nov 12");
  assertStringIncludes(r.text, "“Can you come Saturday morning?”");
  assertStringIncludes(r.text, "Questions from the client");
  assertStringIncludes(r.text, "Text back");
  assert(!r.text.includes("Contact them back"), r.text);
});

Deno.test("REQ-701 M21 inquiryReply: several waiting — a count, at most three, the rest counted; the link is the first one's quote", () => {
  const four = [0, 1, 2, 3].map((i) => ({
    ...LINDA_Q,
    quoteId: `q-${i}`,
    quoteNumber: `Q-00${i + 1}`,
    name: `Client ${i + 1}`,
    question: `Question ${i + 1}?`,
  }));
  const r = inquiryReply("en", four);
  assertStringIncludes(r.text, "4 client questions");
  assertStringIncludes(r.text, "Question 1?");
  assertStringIncludes(r.text, "Question 3?");
  assert(!r.text.includes("Question 4?"), r.text);
  assertStringIncludes(r.text, "1 more");
  assertEquals(r.link?.quoteId, "q-0");
});

Deno.test("REQ-701 M21 inquiryReply: nothing waiting — says so and where questions show up; no link", () => {
  const es = inquiryReply("es", []);
  assertStringIncludes(
    es.text,
    "No hay preguntas de clientes esperando respuesta",
  );
  assertStringIncludes(es.text, "Preguntas del cliente");
  assertEquals(es.link, undefined);
  const en = inquiryReply("en", []);
  assertStringIncludes(en.text, "No client question is waiting for an answer");
});
