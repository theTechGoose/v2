/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — the assistant's server-written
 * answers: the three price tiers for a pricing question, and where the bill
 * stands for a "send him the invoice" ask. Pure: no I/O, no model.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { billingReply, owedReply, pricingReply } from "./mod.ts";

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
    "Ana López todavía no te debe nada — INV-001 por $400 está programada", // REQ-673: one sentence
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
// REQ-656 (demo-loop cycle 5, M9) — "Trabajo terminado, factura a María
// López" on a signed pay-on-completion job: Send now is the answer.
// ---------------------------------------------------------------------------

const MARIA = {
  id: "q-9",
  status: "accepted",
  acceptedAt: "2026-11-12T05:35:18Z",
  customerSnapshot: { name: "María López" },
};
const COMPLETION = {
  id: "inv-9",
  number: "INV-001",
  quoteId: "q-9",
  status: "scheduled",
  amount: 18_000,
  scheduledFor: "2026-11-19",
  dueDate: "2026-12-19",
  installmentIndex: 1,
  installmentTotal: 1,
  createdAt: "2026-11-12T05:35:19Z",
};

Deno.test("REQ-656 M9 billingReply: job done on a signed job whose invoice is scheduled — leads with Send now, never 'nothing billed yet'", () => {
  const es = billingReply("es", MARIA, [COMPLETION], [], { jobDone: true });
  assertEquals(
    es.text.includes("todavía no se ha facturado nada"),
    false,
    es.text,
  );
  assertStringIncludes(es.text, "INV-001");
  assertStringIncludes(es.text, "$180");
  assertStringIncludes(es.text, "María López");
  assertStringIncludes(es.text, "Enviar ahora");
  assertEquals(es.invoice?.id, "inv-9");
  assertEquals(es.invoice?.offerSend, true);
  assertEquals(es.offerInvoiceCta, false);

  const en = billingReply("en", MARIA, [COMPLETION], [], { jobDone: true });
  assertEquals(/nothing is billed yet/i.test(en.text), false, en.text);
  assertStringIncludes(en.text, "Send now");
  assertStringIncludes(en.text, "Nov 19");
});

Deno.test("REQ-656 M9 billingReply: job done with the deposit out and the balance scheduled — the balance, with Send now, is the answer", () => {
  const r = billingReply("en", SIGNED, [DEPOSIT, BALANCE], [], { jobDone: true });
  assertStringIncludes(r.text, "INV-002");
  assertStringIncludes(r.text, "Send now");
  assertEquals(r.invoice?.id, "inv-2");
  assertEquals(r.invoice?.offerSend, true);
});

Deno.test("REQ-656 M9 billingReply: without the job-done cue the answer is unchanged (REQ-388)", () => {
  const r = billingReply("en", MARIA, [COMPLETION]);
  assertStringIncludes(r.text, "nothing is billed yet");
});

// ---------------------------------------------------------------------------
// REQ-673 (demo-loop cycle 5, p18-3e): "What does Maria owe me?" — Maria
// signed Q-001 ($280, pay on completion: INV-001 scheduled for Nov 12, due
// Dec 12) and the contractor had added CO-001 (+$40), still pending. The
// reply said the $280 twice ("$280 isn't billed yet. The $280 invoice
// (INV-001) hasn't gone out yet …") and never mentioned the change order.
// ---------------------------------------------------------------------------

const MARIA_QUOTE = {
  id: "q-maria",
  number: "Q-001",
  status: "accepted",
  acceptedAt: "2026-11-12T19:05:37Z",
  estimatedTotal: 28_000,
  customerSnapshot: { name: "Maria Lopez" },
};
const MARIA_INVOICE = {
  id: "inv-maria",
  number: "INV-001",
  quoteId: "q-maria",
  status: "scheduled",
  amount: 28_000,
  scheduledFor: "2026-11-12",
  dueDate: "2026-12-12",
  installmentIndex: 1,
  installmentTotal: 1,
};
const MARIA_CO = {
  id: "co-maria",
  number: "CO-001",
  invoiceId: "inv-maria",
  quoteId: "q-maria",
  status: "pending",
  deltaAmountCents: 4_000,
};
const count = (text: string, s: string) => text.split(s).length - 1;

Deno.test("REQ-673 owedReply: a scheduled-only bill is ONE sentence (the $280 said once) and the pending CO-001 +$40 is mentioned", () => {
  const r = owedReply("en", {
    name: "Maria Lopez",
    quotes: [MARIA_QUOTE],
    invoices: [MARIA_INVOICE],
    changeOrders: [MARIA_CO],
    today: "2026-11-12",
  });
  assertEquals(
    r.text,
    "Maria Lopez doesn't owe you anything yet — INV-001 for $280 goes out Nov 12, due Dec 12. Plus CO-001 (+$40) is waiting for Maria Lopez's approval.",
  );
  assertEquals(count(r.text, "$280"), 1, r.text);
  // a pending change order is not owed and not billed yet
  assertEquals(r.owedCents, 0);
  assertEquals(r.upcomingCents, 28_000);
});

Deno.test("REQ-673 owedReply: Spanish — one sentence, the CO mentioned", () => {
  const r = owedReply("es", {
    name: "Maria Lopez",
    quotes: [MARIA_QUOTE],
    invoices: [MARIA_INVOICE],
    changeOrders: [MARIA_CO],
    today: "2026-11-12",
  });
  assertEquals(count(r.text, "$280"), 1, r.text);
  assertStringIncludes(
    r.text,
    "Maria Lopez todavía no te debe nada — INV-001 por $280",
  );
  assertStringIncludes(r.text, "12 nov");
  assertStringIncludes(r.text, "12 dic");
  assertStringIncludes(r.text, "CO-001 (+$40)");
  assertStringIncludes(r.text, "aprobación de Maria Lopez");
  assert(!/invoice|change order/i.test(r.text), r.text);
});

Deno.test("REQ-673 owedReply: approved / declined change orders are not 'waiting'; a credit reads -$40", () => {
  for (const status of ["approved", "declined"]) {
    const r = owedReply("en", {
      name: "Maria Lopez",
      quotes: [MARIA_QUOTE],
      invoices: [MARIA_INVOICE],
      changeOrders: [{ ...MARIA_CO, status }],
    });
    assert(!r.text.includes("CO-001"), r.text);
  }
  const credit = owedReply("en", {
    name: "Maria Lopez",
    quotes: [MARIA_QUOTE],
    invoices: [MARIA_INVOICE],
    changeOrders: [{ ...MARIA_CO, deltaAmountCents: -4_000 }],
  });
  assertStringIncludes(credit.text, "CO-001 (-$40)");
});

Deno.test("REQ-673 billingReply: signed, only a scheduled invoice — one sentence, the amount once, and the pending CO mentioned", () => {
  const r = billingReply("en", MARIA_QUOTE, [MARIA_INVOICE], [MARIA_CO]);
  assertEquals(
    r.text,
    "Maria Lopez signed — nothing is billed yet: INV-001 for $280 goes out Nov 12, due Dec 12. Plus CO-001 (+$40) is waiting for Maria Lopez's approval.",
  );
  assertEquals(r.invoice?.id, "inv-maria");
  const es = billingReply("es", MARIA_QUOTE, [MARIA_INVOICE], [MARIA_CO]);
  assertEquals(count(es.text, "$280"), 1, es.text);
  assertStringIncludes(es.text, "CO-001 (+$40)");
  // the billed path mentions a pending CO too
  const out = billingReply("en", SIGNED, [DEPOSIT, BALANCE], [
    { ...MARIA_CO, number: "CO-002", invoiceId: "inv-1", quoteId: "q-1" },
  ]);
  assertStringIncludes(
    out.text,
    "CO-002 (+$40) is waiting for John Miller's approval",
  );
});
