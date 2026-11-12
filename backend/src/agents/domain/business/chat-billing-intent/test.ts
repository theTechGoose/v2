/**
 * REQ-583 (demo-loop cycle 4, M2) — the pure reads behind "the assistant
 * sends the invoice / records the payment it is told about".
 *
 * The demo's dead ends (run r857a9d67):
 *   pair 1: "Linda paid the deposit $1,425 by Zelle today. Send her the
 *           invoice" → an invoice summary, no payment recorded;
 *   pair 7: "she paid the deposit by check" → "You can check the payment
 *           status in the Invoices section.";
 *   pair 3: "send it to her now please" (right after the scheduled-invoice
 *           answer) → "I can't send the invoice directly…";
 *   pair 9: "Mándala ahora por favor, ya terminé hoy" → "No puedo enviar la
 *           factura ahora…".
 */
import { assertEquals } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import {
  invoicesContext,
  liveSendOffer,
  namedCustomer,
  parsePaymentReport,
  parseSendInvoiceAsk,
  pickPaymentInvoice,
  unsentInvoiceOf,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// parsePaymentReport
// ---------------------------------------------------------------------------

Deno.test("REQ-583 M2 parsePaymentReport: pair 1 — 'Linda paid the deposit $1,425 by Zelle today. Send her the invoice' is a $1,425 Zelle payment on the deposit", () => {
  assertEquals(
    parsePaymentReport(
      "Linda paid the deposit $1,425 by Zelle today. Send her the invoice",
    ),
    { amountCents: 142_500, method: "zelle", which: "deposit" },
  );
});

Deno.test("REQ-583 M2 parsePaymentReport: pair 7 — 'she paid the deposit by check' is a check payment on the deposit", () => {
  assertEquals(parsePaymentReport("she paid the deposit by check"), {
    method: "check",
    which: "deposit",
  });
});

Deno.test("REQ-583 M2 parsePaymentReport: other ways a contractor says the customer paid (EN)", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["Got $500 cash from Ana for the fence", {
      amountCents: 50_000,
      method: "cash",
    }],
    ["Carol paid INV-002 in full by card", {
      invoiceNumber: "INV-002",
      method: "card",
    }],
    ["Received the check for the balance, check #1043", {
      method: "check",
      which: "balance",
      reference: "1043",
    }],
    ["mark INV-001 as paid", { invoiceNumber: "INV-001" }],
    ["Bob paid $1,200.50 via Venmo", { amountCents: 120_050, method: "venmo" }],
    ["John just paid me $800 through Cash App", {
      amountCents: 80_000,
      method: "cashapp",
    }],
    ["the Zelle for inv-3 came in", {
      invoiceNumber: "INV-3",
      method: "zelle",
    }],
  ];
  for (const [text, want] of cases) {
    assertEquals(parsePaymentReport(text), want, text);
  }
});

Deno.test("REQ-583 M2 parsePaymentReport: Spanish", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["Juan me pagó $450 por Zelle", { amountCents: 45_000, method: "zelle" }],
    ["Ya pagó el anticipo con cheque", { method: "check", which: "deposit" }],
    ["Recibí el pago de $450 en efectivo", {
      amountCents: 45_000,
      method: "cash",
    }],
    ["Me pagaron el saldo por transferencia", {
      method: "ach",
      which: "balance",
    }],
    ["La factura INV-001 ya está pagada", { invoiceNumber: "INV-001" }],
  ];
  for (const [text, want] of cases) {
    assertEquals(parsePaymentReport(text), want, text);
  }
});

Deno.test("REQ-583 M2 parsePaymentReport: questions, negations, plans, payment terms and the contractor's own payments are not a payment to record", () => {
  for (
    const text of [
      "has she paid?",
      "Has Linda paid the deposit",
      "did Linda pay the deposit by Zelle?",
      "when will Ana pay me?",
      "she hasn't paid yet",
      "Linda didn't pay the deposit",
      "she will pay by Zelle",
      "she's going to pay the deposit by check",
      "I paid the supplier $300 cash",
      "we paid $120 for the permit",
      "how do customers pay by card?",
      "do you accept Zelle?",
      "¿ya pagó Juan?",
      "Juan no ha pagado",
      "Juan todavía no me paga",
      "pagué el material con tarjeta",
      "the deposit should be paid by check",
      "deposit to be paid by Zelle, balance on completion",
      "50% deposit paid upon signing, rest when done",
      "I want a 50% deposit upfront",
      "Send her the invoice",
      "¿Cuánto me debe Ana López?",
      "she paid $300 for the tile herself",
      "she paid",
      "Make the invoice for $450 please",
      // "paid" describing something, and a term inside a quote request
      "Add $20 for paid parking",
      "Quote Bob a water heater swap, $1,200, paid in full upon completion",
      "upgrade them to the paid plan for $30",
      "",
    ]
  ) {
    assertEquals(parsePaymentReport(text), undefined, text);
  }
});

// ---------------------------------------------------------------------------
// parseSendInvoiceAsk
// ---------------------------------------------------------------------------

Deno.test("REQ-583 M2 parseSendInvoiceAsk: pair 3's 'send it to her now please' and pair 9's 'Mándala ahora por favor, ya terminé hoy' are a send-it-now", () => {
  for (
    const text of [
      "send it to her now please",
      "Mándala ahora por favor, ya terminé hoy",
      "send it now",
      "Send now",
      "send it",
      "yes, send it to Maria",
      "Go ahead and send it",
      "can you send it now?",
      "mándala ya",
      "sí, envíasela",
      "ok send it out today",
    ]
  ) {
    assertEquals(parseSendInvoiceAsk(text), {}, text);
  }
});

Deno.test("REQ-583 M2 parseSendInvoiceAsk: a number names the invoice; 'text it' / 'email it' pick the channel", () => {
  assertEquals(parseSendInvoiceAsk("Send INV-001 now"), {
    invoiceNumber: "INV-001",
  });
  assertEquals(parseSendInvoiceAsk("Envía inv-2 ahora"), {
    invoiceNumber: "INV-2",
  });
  assertEquals(parseSendInvoiceAsk("text it to him"), { channel: "text" });
  assertEquals(parseSendInvoiceAsk("email it to her now"), {
    channel: "email",
  });
  assertEquals(parseSendInvoiceAsk("Mándasela por mensaje"), {
    channel: "text",
  });
});

Deno.test("REQ-583 M2 parseSendInvoiceAsk: the invoice card's Send-now button words are read back (en + es)", () => {
  for (const lang of ["en", "es"] as const) {
    const said = t(lang, "asstChat.invoiceCard.sendNowText", {
      number: "INV-001",
    });
    assertEquals(parseSendInvoiceAsk(said), { invoiceNumber: "INV-001" }, said);
  }
});

Deno.test("REQ-583 M2 parseSendInvoiceAsk: not now, not a question, not the general 'send him the invoice' ask (that one answers with where the bill stands)", () => {
  for (
    const text of [
      "don't send it yet",
      "do not send it",
      "send it later",
      "send it tomorrow",
      "send it on Nov 19",
      "did you send it?",
      "when does it go out?",
      "no la mandes todavía",
      "send him the deposit invoice",
      "send her the invoice",
      "mándale la factura",
      "Send the quote",
      "send it to me",
      "",
    ]
  ) {
    assertEquals(parseSendInvoiceAsk(text), undefined, text);
  }
});

// ---------------------------------------------------------------------------
// liveSendOffer
// ---------------------------------------------------------------------------

const offerCard = {
  role: "assistant",
  kind: "action_card",
  content: "Invoice INV-001 · due Dec 19",
  payload: {
    actionType: "invoice",
    status: "scheduled",
    invoiceId: "inv-1",
    number: "INV-001",
    offerSend: true,
  },
};

Deno.test("REQ-583 M2 liveSendOffer: the reply to the last message offered 'Send now' for INV-001", () => {
  const earlier = [
    { role: "user", kind: "text", content: "Invoice Maria for the deep clean" },
    { role: "assistant", kind: "text", content: "Maria Lopez signed — …" },
    offerCard,
  ];
  assertEquals(liveSendOffer(earlier), {
    invoiceId: "inv-1",
    number: "INV-001",
  });
});

Deno.test("REQ-583 M2 liveSendOffer: an offer from an older turn, a card without the offer, or a sent card is not live", () => {
  assertEquals(
    liveSendOffer([
      { role: "user", kind: "text", content: "Invoice Maria" },
      offerCard,
      { role: "user", kind: "text", content: "add a line" },
      { role: "assistant", kind: "text", content: "Added." },
    ]),
    undefined,
  );
  assertEquals(
    liveSendOffer([
      { role: "user", kind: "text", content: "Invoice Maria" },
      {
        ...offerCard,
        payload: { ...offerCard.payload, offerSend: undefined },
      },
    ]),
    undefined,
  );
  assertEquals(
    liveSendOffer([
      { role: "user", kind: "text", content: "Invoice Maria" },
      { ...offerCard, payload: { ...offerCard.payload, status: "sent" } },
    ]),
    undefined,
  );
  assertEquals(liveSendOffer([]), undefined);
});

// ---------------------------------------------------------------------------
// pickPaymentInvoice / unsentInvoiceOf
// ---------------------------------------------------------------------------

const DEPOSIT = {
  id: "inv-1",
  number: "INV-001",
  status: "sent",
  amount: 142_500,
  installmentIndex: 1,
  installmentTotal: 2,
  createdAt: "2026-11-12T15:07:00Z",
};
const BALANCE = {
  id: "inv-2",
  number: "INV-002",
  status: "scheduled",
  amount: 142_500,
  scheduledFor: "2026-11-22",
  installmentIndex: 2,
  installmentTotal: 2,
  createdAt: "2026-11-12T15:07:00Z",
};

Deno.test("REQ-583 M2 pickPaymentInvoice: pair 1 — the deposit, at the amount said", () => {
  const r = pickPaymentInvoice([BALANCE, DEPOSIT], {
    amountCents: 142_500,
    method: "zelle",
    which: "deposit",
  });
  assertEquals(r.kind, "invoice");
  if (r.kind !== "invoice") return;
  assertEquals(r.invoice.id, "inv-1");
  assertEquals(r.amountCents, 142_500);
});

Deno.test("REQ-583 M2 pickPaymentInvoice: pair 7 — 'the deposit' with no amount is the deposit's balance", () => {
  const r = pickPaymentInvoice([DEPOSIT, BALANCE], {
    method: "check",
    which: "deposit",
  });
  assertEquals(r.kind === "invoice" && r.invoice.id, "inv-1");
  assertEquals(r.kind === "invoice" && r.amountCents, 142_500);
  // a part payment already on it: what is still owed
  const part = pickPaymentInvoice([{ ...DEPOSIT, paidCents: 42_500 }], {
    which: "deposit",
  });
  assertEquals(part.kind === "invoice" && part.amountCents, 100_000);
});

Deno.test("REQ-583 M2 pickPaymentInvoice: the balance, a number, the one open invoice, an amount that matches one", () => {
  const balance = pickPaymentInvoice([DEPOSIT, BALANCE], { which: "balance" });
  assertEquals(balance.kind === "invoice" && balance.invoice.id, "inv-2");
  const named = pickPaymentInvoice([DEPOSIT, BALANCE], {
    invoiceNumber: "INV-2",
  });
  assertEquals(named.kind === "invoice" && named.invoice.id, "inv-2");
  // nothing said but how: the one invoice out with the customer
  const open = pickPaymentInvoice([DEPOSIT, BALANCE], { method: "cash" });
  assertEquals(open.kind === "invoice" && open.invoice.id, "inv-1");
  // a part payment on the one open invoice
  const partial = pickPaymentInvoice([DEPOSIT, BALANCE], {
    amountCents: 50_000,
  });
  assertEquals(partial.kind === "invoice" && partial.invoice.id, "inv-1");
  assertEquals(partial.kind === "invoice" && partial.amountCents, 50_000);
});

Deno.test("REQ-583 M2 pickPaymentInvoice: already paid, unknown number, nothing to pay, or two that fit → said, nothing guessed", () => {
  const paid = pickPaymentInvoice([{ ...DEPOSIT, status: "paid" }, BALANCE], {
    which: "deposit",
  });
  assertEquals(paid.kind, "already_paid");
  assertEquals(
    pickPaymentInvoice([DEPOSIT], { invoiceNumber: "INV-009" }).kind,
    "none",
  );
  assertEquals(pickPaymentInvoice([], { method: "zelle" }).kind, "none");
  const other = {
    ...DEPOSIT,
    id: "inv-7",
    number: "INV-007",
    installmentIndex: undefined,
    installmentTotal: undefined,
  };
  const two = pickPaymentInvoice([DEPOSIT, other], { method: "zelle" });
  assertEquals(two.kind, "ask");
  assertEquals(
    two.kind === "ask" && two.candidates.map((c) => c.id).sort(),
    ["inv-1", "inv-7"],
  );
});

Deno.test("REQ-583 M2 pickPaymentInvoice: across all of a contractor's invoices only an amount that matches exactly one is taken", () => {
  const other = { ...DEPOSIT, id: "inv-7", number: "INV-007", amount: 45_000 };
  const hit = pickPaymentInvoice([DEPOSIT, other], { amountCents: 45_000 }, {
    amountMustMatch: true,
  });
  assertEquals(hit.kind === "invoice" && hit.invoice.id, "inv-7");
  assertEquals(
    pickPaymentInvoice([DEPOSIT], { amountCents: 99_900 }, {
      amountMustMatch: true,
    }).kind,
    "none",
  );
  assertEquals(
    pickPaymentInvoice([DEPOSIT], { method: "zelle" }, {
      amountMustMatch: true,
    }).kind,
    "none",
  );
});

Deno.test("REQ-583 M2 unsentInvoiceOf: the first invoice not sent yet (scheduled or drafted), never a void one", () => {
  assertEquals(unsentInvoiceOf([DEPOSIT, BALANCE])?.id, "inv-2");
  assertEquals(unsentInvoiceOf([DEPOSIT]), undefined);
  assertEquals(
    unsentInvoiceOf([{ ...BALANCE, status: "void" }, {
      ...DEPOSIT,
      status: "draft",
    }])?.id,
    "inv-1",
  );
});

// ---------------------------------------------------------------------------
// invoicesContext / namedCustomer
// ---------------------------------------------------------------------------

Deno.test("REQ-583 M2 invoicesContext: the model reads what is billed, what is scheduled and what is paid", () => {
  const text = invoicesContext([
    { ...DEPOSIT, dueDate: "2026-11-19" },
    BALANCE,
  ]);
  assertEquals(text.split("\n")[0], "Invoices on this quote:");
  assertEquals(text.includes("INV-001 $1,425.00"), true, text);
  assertEquals(text.includes("sent"), true, text);
  assertEquals(text.includes("INV-002 $1,425.00"), true, text);
  assertEquals(text.includes("scheduled to go out 2026-11-22"), true, text);
  assertEquals(text.includes("not sent yet"), true, text);
  assertEquals(invoicesContext([]), "");
});

Deno.test("REQ-583 M2 namedCustomer: the whole name typed, else one customer's first name typed as a name", () => {
  const people = [
    { id: "c-1", name: "Carmen Ruiz" },
    { id: "c-2", name: "Pedro Gómez" },
    { id: "c-3", name: "Linda Perez" },
  ];
  assertEquals(
    namedCustomer(
      people,
      "Job done for Carmen Ruiz, faucet and the 2 doors. Make the invoice for $450 please.",
    )?.id,
    "c-1",
  );
  assertEquals(
    namedCustomer(people, "Quiero la factura, ya terminé el trabajo de Carmen.")
      ?.id,
    "c-1",
  );
  assertEquals(
    namedCustomer(people, "Linda paid the deposit $1,425 by Zelle today")?.id,
    "c-3",
  );
  // no name, a lower-case word, or two people sharing it → nobody
  assertEquals(namedCustomer(people, "make the invoice for $450"), undefined);
  assertEquals(namedCustomer(people, "send carmen the invoice"), undefined);
  assertEquals(
    namedCustomer(
      [...people, { id: "c-4", name: "Carmen Díaz" }],
      "invoice Carmen",
    ),
    undefined,
  );
});
