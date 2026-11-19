/**
 * REQ-1084 (LOOP-007 cycle 3, q3-18) — revising a sent quote by adding one
 * line and removing another answered "I couldn't find a line called
 * 'Pintura interior (pasillo)' … so I changed nothing".
 *
 * The tester's Q-002 (sent, unsigned): "Pintura interior (3 cuartos y sala,
 * paredes y techos)" $2,300 + "Reparación de drywall en la cocina" $380 =
 * $2,680. ES: "Jose quiere agregar pintar el pasillo por $450 y quitar el
 * drywall. hazme una nueva versión"; EN: "add a new line: hallway painting
 * $450. and remove the drywall line. make it version 2". The model sent
 * revise_quote { lines: [{ match: "Pintura interior (pasillo)", amountCents:
 * 45000 }], remove: ["drywall"] } — the new line in lines[], because the tool
 * had no add field.
 *
 * Real stores, in-memory KV; the coordinator runs exactly as the chat calls
 * it. Version 2 must be $2,300 + $450 = $2,750 with no drywall line, both for
 * the legacy lines[] form (the model still does that) and for an `add` field.
 */
import { assert, assertEquals } from "#std/assert";
import { ReviseQuote, type ReviseQuoteInput } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const LINES = [
  {
    description: "Pintura interior (3 cuartos y sala, paredes y techos)",
    quantity: 1,
    unit: "trabajo",
    price: 230_000,
  },
  {
    description: "Reparación de drywall en la cocina",
    quantity: 1,
    unit: "trabajo",
    price: 38_000,
  },
];

const ES_TEXT =
  "Jose quiere agregar pintar el pasillo por $450 y quitar el drywall. hazme una nueva versión";
const EN_TEXT =
  "add a new line: hallway painting $450. and remove the drywall line. make it version 2";

type Extra = Partial<ReviseQuoteInput> & {
  add?: { description: string; amountCents: number }[];
};

async function runOnSentQ002(input: Extra) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const quotes = new QuoteStore();
    const customers = new CustomerStore();
    const revise = new ReviseQuote(quotes, customers);
    // Q-001 first, so the one revised is Q-002 like the tester's.
    await quotes.create("u-1", {
      summary: "Otro trabajo",
      lineItems: [{ description: "Limpieza", quantity: 1, unit: "job", price: 10_000 }],
      estimatedTotal: 10_000,
    } as never);
    const created = await quotes.create("u-1", {
      summary: "Pintura interior y drywall — Jose",
      jobName: "Pintura interior y drywall",
      lineItems: LINES,
      estimatedTotal: 268_000,
    } as never);
    assertEquals(created.number, "Q-002");
    await quotes.update(created.id, "u-1", {
      status: "sent",
      sentAt: new Date().toISOString(),
    } as never);

    const out = await revise.run({
      userId: "u-1",
      lang: "es",
      boundQuoteId: created.id,
      lines: [],
      remove: [],
      userText: "",
      ...input,
    } as ReviseQuoteInput);
    const after = await quotes.get(created.id);
    return { out, after };
  } finally {
    await resetKv();
  }
}

function assertVersion2(
  { out, after }: Awaited<ReturnType<typeof runOnSentQ002>>,
) {
  assert(
    !/changed nothing|no cambié nada/i.test(out.text),
    `the reply refuses the add + remove: ${out.text}`,
  );
  assertEquals(out.outcome.kind, "pending_revision", out.text);
  if (out.outcome.kind === "pending_revision") {
    assertEquals(out.outcome.nextVersion, 2);
  }
  const pending = after?.pendingRevision as
    | {
      lineItems?: { description: string; price?: number; quantity?: number }[];
      estimatedTotal?: number;
    }
    | undefined;
  const lines = pending?.lineItems ?? [];
  assertEquals(lines.length, 2, `two lines: ${JSON.stringify(lines)}`);
  assert(
    !lines.some((l) => /drywall/i.test(l.description)),
    `the drywall line is gone: ${JSON.stringify(lines)}`,
  );
  const painting = lines.find((l) => /3 cuartos/.test(l.description));
  assertEquals(painting?.price, 230_000, "the painting line keeps $2,300");
  const added = lines.find((l) => !/3 cuartos/.test(l.description));
  assertEquals(
    (added?.price ?? 0) * (added?.quantity ?? 1),
    45_000,
    `the hallway line is added at $450: ${JSON.stringify(added)}`,
  );
  assertEquals(pending?.estimatedTotal, 275_000, "Version 2 is $2,750");
  assertEquals(after?.estimatedTotal, 268_000, "Version 1 is untouched");
}

Deno.test("REQ-1084 q3-18 ReviseQuote (ES, the tester's payload): lines:[{match:'Pintura interior (pasillo)', 45000}] + remove drywall on the sent Q-002 → pending Version 2 at $2,750, never 'no cambié nada'", async () => {
  assertVersion2(
    await runOnSentQ002({
      lang: "es",
      quoteNumber: "Q-002",
      lines: [{ match: "Pintura interior (pasillo)", amountCents: 45_000 }],
      remove: ["drywall"],
      userText: ES_TEXT,
    }),
  );
});

Deno.test("REQ-1084 q3-18 ReviseQuote (EN, the tester's payload): lines:[{match:'Pintura interior (pasillo)', 45000}] + remove drywall on the sent Q-002 → pending Version 2 at $2,750, never 'I changed nothing'", async () => {
  assertVersion2(
    await runOnSentQ002({
      lang: "en",
      quoteNumber: "Q-002",
      lines: [{ match: "Pintura interior (pasillo)", amountCents: 45_000 }],
      remove: ["drywall"],
      userText: EN_TEXT,
    }),
  );
});

Deno.test("REQ-1084 q3-18 ReviseQuote (the `add` field): add [{Pintura del pasillo, 45000}] + remove drywall on the sent Q-002 → pending Version 2 at $2,750", async () => {
  assertVersion2(
    await runOnSentQ002({
      lang: "es",
      quoteNumber: "Q-002",
      lines: [],
      remove: ["drywall"],
      add: [{ description: "Pintura del pasillo", amountCents: 45_000 }],
      userText: ES_TEXT,
    }),
  );
});
