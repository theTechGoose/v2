import { assertEquals } from "@std/assert";
import { jobRowTitle, quoteRowTitle } from "./dashboard-titles.ts";
import type { Job } from "../clients/dashboard.ts";
import type { QuoteCard } from "../clients/quotes.ts";

// REQ-497 (demo-loop cycle 3, m23): the dashboard's job and quote rows title
// a document in the language the app shows — the REQ-394 quoteJobTitle rule
// /quotes already uses — never the primary summary in whatever language the
// quote was written in ("Bathroom remodel — Maria Lopez" on the Spanish app).

const job = (quote: Partial<Job["quote"]>): Job => ({
  id: "q1",
  customer: { id: "c1", name: "Maria Lopez" },
  quote: {
    id: "q1",
    summary: "Bathroom remodel — Maria Lopez",
    estimatedTotalCents: 9_600_00,
    ...quote,
  },
  totalCents: 9_600_00,
  paidCents: 0,
  pctPaid: 0,
  nextDueDate: null,
  status: "on_track",
  statusLabel: "On track",
});

const card = (q: Partial<QuoteCard>): QuoteCard =>
  ({
    id: "q2",
    userId: "u1",
    customerName: "Ana Ruiz",
    summary: "Fence repair — Ana Ruiz",
    opens: 0,
    ...q,
  }) as QuoteCard;

Deno.test("REQ-497 jobRowTitle: an English job on the Spanish dashboard reads its Spanish name", () => {
  const j = job({
    jobName: "Bathroom Remodel",
    jobNameByLang: { en: "Bathroom Remodel", es: "Remodelación de baño" },
  });
  assertEquals(jobRowTitle(j, "es"), "Remodelación de baño");
  assertEquals(jobRowTitle(j, "en"), "Bathroom Remodel");
});

Deno.test("REQ-497 jobRowTitle: no name map falls back to the summary in that language, then the primary", () => {
  const j = job({
    summaryByLang: { es: "Remodelación de baño — Maria Lopez" },
  });
  assertEquals(jobRowTitle(j, "es"), "Remodelación de baño — Maria Lopez");
  assertEquals(jobRowTitle(j, "en"), "Bathroom remodel — Maria Lopez");
  assertEquals(jobRowTitle(job({ summary: "" }), "es"), "");
});

Deno.test("REQ-497 quoteRowTitle: a sent English quote on the Spanish dashboard reads its Spanish name", () => {
  const q = card({
    jobName: "Fence Repair",
    jobNameByLang: { en: "Fence Repair", es: "Reparación de cerca" },
    summaryByLang: { es: "Reparación de cerca — Ana Ruiz" },
  });
  assertEquals(quoteRowTitle(q, "es"), "Reparación de cerca");
  assertEquals(quoteRowTitle(q, "en"), "Fence Repair");
  assertEquals(quoteRowTitle(card({ summary: undefined }), "es"), "");
});
