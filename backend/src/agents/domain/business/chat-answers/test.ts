/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — the assistant's server-written
 * answers: the three price tiers for a pricing question, and where the bill
 * stands for a "send him the invoice" ask. Pure: no I/O, no model.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { billingReply, pricingReply } from "./mod.ts";

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

Deno.test("REQ-368 M30 pricingReply: names the job and place, lists the three tiers with their prices, and says what the draft is at", () => {
  const text = pricingReply("en", {
    job: "panel swap 200a",
    where: "Austin, TX",
    options: TIERS,
    basis: "labor_and_materials",
    draftedAt: "Market",
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
    draftedAt: "De mercado",
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
