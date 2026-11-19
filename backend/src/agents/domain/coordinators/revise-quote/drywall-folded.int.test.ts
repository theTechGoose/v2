/**
 * REQ-1095 (LOOP-007 cycle 3, q3-19 + q3-20) — "add hallway painting $450 to
 * Q-002" on a SENT Q-002 (Pintura interior $2,300 + Reparación de drywall en
 * la cocina $380 = $2,680, titled "Pintura interior y drywall").
 *
 * q3-19: the model's revise_quote removed the drywall line and echoed the
 * quote's CURRENT total as newTotalDollars (2680 → targetTotalCents 268000).
 * The owner's words carry no total, yet ReviseQuote trusted it and
 * settleToTotal folded the removed $380 into the painting line
 * ($2,300 → $2,680).
 *
 * q3-20: the pending patch is { lineItems, estimatedTotal } (+ job details),
 * so Version 2 keeps the V1 title "Pintura interior y drywall" — and that is
 * what the published version, the email subject and the SMS name.
 *
 * Real stores, in-memory KV; the coordinator runs exactly as the chat calls it.
 */
import { assert, assertEquals } from "#std/assert";
import { ReviseQuote, type ReviseQuoteInput } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { publishPendingQuote } from "@paperwork/domain/business/publish-pending/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const PAINT = "Pintura interior";
const DRYWALL = "Reparación de drywall en la cocina";
const LINES = [
  { description: PAINT, quantity: 1, unit: "trabajo", price: 230_000 },
  { description: DRYWALL, quantity: 1, unit: "trabajo", price: 38_000 },
];
const USER_TEXT = "add hallway painting $450 to Q-002";

async function sentQ002() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const jose = await customers.create("u-1", { name: "Jose Ramirez" });
  await quotes.create("u-1", {
    summary: "Otro trabajo",
    lineItems: [{
      description: "Limpieza",
      quantity: 1,
      unit: "job",
      price: 10_000,
    }],
    estimatedTotal: 10_000,
  } as never);
  const draft = await quotes.create("u-1", {
    summary: "Pintura interior y reparación de drywall — Jose Ramirez",
    summaryByLang: {
      es: "Pintura interior y reparación de drywall — Jose Ramirez",
      en: "Interior painting and drywall repair — Jose Ramirez",
    },
    jobName: "Pintura interior y drywall",
    jobNameByLang: {
      es: "Pintura interior y drywall",
      en: "Interior Painting and Drywall",
    },
    customerId: jose.id,
    lineItems: LINES,
    estimatedTotal: 268_000,
  } as never);
  assertEquals(draft.number, "Q-002");
  await quotes.update(draft.id, "u-1", {
    status: "sent",
    sentAt: new Date().toISOString(),
  } as never);
  return {
    quotes,
    revise: new ReviseQuote(quotes, customers),
    quoteId: draft.id,
  };
}

type Pending = {
  estimatedTotal?: number;
  lineItems?: { description: string; price: number }[];
  jobName?: string;
  jobNameByLang?: Record<string, string>;
  summary?: string;
  summaryByLang?: Record<string, string>;
};

Deno.test("REQ-1095 q3-19: the model echoing the CURRENT total (newTotalDollars 2680) while removing drywall never folds the drywall's $380 into Pintura interior — Pintura stays $2,300, Version 2 is $2,300", async () => {
  const { quotes, revise, quoteId } = await sentQ002();
  try {
    const out = await revise.run({
      userId: "u-1",
      lang: "en",
      boundQuoteId: quoteId,
      quoteNumber: "Q-002",
      lines: [],
      remove: [DRYWALL],
      userText: USER_TEXT,
      // what the model sent: the quote's current total, not anything he typed
      targetTotalCents: 268_000,
    } as ReviseQuoteInput);
    const after = await quotes.getOwned(quoteId, "u-1");
    const pending = after.pendingRevision as Pending | undefined;
    assertEquals(out.outcome.kind, "pending_revision", out.text);
    const paint = pending?.lineItems?.find((l) => l.description === PAINT);
    assertEquals(
      paint?.price,
      230_000,
      `Pintura interior must stay $2,300 — he never named or priced it. reply: ${out.text}`,
    );
    assertEquals(
      pending?.estimatedTotal,
      230_000,
      `Version 2 must not carry the removed drywall's $380 — reply: ${out.text}`,
    );
    assert(!/\$2,300\.00 → \$2,680/.test(out.text), out.text);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1095 q3-20: removing the drywall line from a sent quote retitles Version 2 — the pending and the published job name / summary (every language) no longer name drywall", async () => {
  const { quotes, revise, quoteId } = await sentQ002();
  try {
    const out = await revise.run({
      userId: "u-1",
      lang: "es",
      boundQuoteId: quoteId,
      quoteNumber: "Q-002",
      lines: [],
      remove: [DRYWALL],
      userText: "quita la reparación de drywall de Q-002",
    } as ReviseQuoteInput);
    assertEquals(out.outcome.kind, "pending_revision", out.text);
    const after = await quotes.getOwned(quoteId, "u-1");
    const pending = (after.pendingRevision ?? {}) as Pending;
    assertEquals(
      pending.lineItems?.map((l) => l.description),
      [PAINT],
      "the drywall line is gone from the draft",
    );

    // What Version 2 will carry: the pending field, else the live one.
    const v2 = <K extends keyof Pending>(k: K) =>
      (k in pending ? pending[k] : (after as unknown as Pending)[k]);
    const jobName = v2("jobName") as string | undefined;
    const jobNameByLang = v2("jobNameByLang") as
      | Record<string, string>
      | undefined;
    const summary = v2("summary") as string | undefined;
    const summaryByLang = v2("summaryByLang") as
      | Record<string, string>
      | undefined;
    assert(
      !/drywall/i.test(jobName ?? ""),
      `Version 2's job name still names the removed drywall: ${
        JSON.stringify(jobName)
      }`,
    );
    for (const [lang, name] of Object.entries(jobNameByLang ?? {})) {
      assert(
        !/drywall/i.test(name),
        `Version 2's ${lang} job name still names the removed drywall: ${
          JSON.stringify(name)
        }`,
      );
    }
    assert(
      !/drywall/i.test(summary ?? ""),
      `Version 2's summary still names the removed drywall: ${
        JSON.stringify(summary)
      }`,
    );
    for (const [lang, s] of Object.entries(summaryByLang ?? {})) {
      assert(
        !/drywall/i.test(s),
        `Version 2's ${lang} summary still names the removed drywall: ${
          JSON.stringify(s)
        }`,
      );
    }

    // Publishing sends what is pending — the published V2 must not name it.
    const published = await publishPendingQuote(quotes, quoteId, "u-1");
    const pub = published as unknown as Pending;
    assert(
      !/drywall/i.test(pub.jobName ?? ""),
      `the published Version 2 is titled ${JSON.stringify(pub.jobName)}`,
    );
    for (const [lang, name] of Object.entries(pub.jobNameByLang ?? {})) {
      assert(
        !/drywall/i.test(name),
        `the published Version 2's ${lang} title is ${JSON.stringify(name)}`,
      );
    }
  } finally {
    await resetKv();
  }
});
