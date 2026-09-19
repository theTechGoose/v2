/**
 * REQ-031 — NW-26 (p17): "Ask a question" on the public quote link must
 * reach the contractor somewhere they can read it. The public inquiry used to
 * emit a bus event only (one bell row no UI showed in full; contactBack
 * dropped). Now SendInquiryAlert emails + texts the contractor and logs both
 * in the comms trail — which GET /messages exposes.
 *
 * Runs against the dev server (:5280/api). Email/SMS are dev-mode there (no
 * Postmark key needed for the log entry: EmailService dev mode returns ok).
 */
import { contractor, seedQuote } from "./helpers/api";

const BASE = process.env.API_BASE_URL ?? "http://localhost:5280/api";
const QUESTION = `Does the price include haul-away? ${Date.now()}`;

interface LoggedMessage {
  channel?: string;
  content?: string;
  paperworkId?: string;
}

async function messagesContaining(
  s: Awaited<ReturnType<typeof contractor>>,
  needle: string,
): Promise<LoggedMessage[]> {
  const { body } = await s.get("/messages");
  const all: LoggedMessage[] = Array.isArray(body)
    ? body
    : (body as { items?: LoggedMessage[] })?.items ?? [];
  return all.filter((m) => (m.content ?? "").includes(needle));
}

describe("REQ-031 NW-26 a public inquiry lands in the contractor's comms trail", () => {
  it("REQ-031 POST /quotes/:id/inquiry → GET /messages has email + text entries carrying the question and contactBack", async () => {
    const s = await contractor("+15125550903");
    const quoteId = await seedQuote(s);

    // The customer, unauthenticated, from the /q link.
    const r = await fetch(`${BASE}/quotes/${quoteId}/inquiry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: QUESTION,
        contactBack: "maria.back@example.com",
        name: "María",
      }),
    });
    expect(r.status).toBe(200);

    let hits: LoggedMessage[] = [];
    for (let i = 0; i < 20 && hits.length < 2; i++) {
      hits = await messagesContaining(s, QUESTION);
      if (hits.length < 2) await new Promise((res) => setTimeout(res, 500));
    }
    expect(hits.map((h) => h.channel).sort()).toEqual(["email", "text"]);
    for (const h of hits) expect(h.content).toContain("maria.back@example.com");
  });
});
