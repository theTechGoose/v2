/**
 * Assistant flows — integration probes for the first-2-hours audit.
 *
 * One quoted problem line per P-id considered here:
 *
 *   P-20 "All four starter chips return the identical canned reply — including
 *        'Trabajo terminado, necesito facturar', which is answered with quote
 *        copy."
 *   P-10 "No timeout on the LLM chat turn."
 *   P-26 "The 'English out' promise fails in the preview." (backend/projection
 *        half — POST /agents/job-details/translate.)
 *
 * ============================================================================
 * EVIDENCE-BACKED VERDICT: none of these three has an honest server-side RED in
 * the running stub-LLM dev stack. Each `it.skip` below carries the curl-grounded
 * proof and a ready ApiSession harness the green agent can un-skip once the
 * intended fix makes a server-side assertion meaningful. The real reds live in
 * the unit file (jest/unit/assistant-contracts.test.ts) and the e2e file
 * (cypress/e2e/assistant-experience.cy.ts). This mirrors the sanctioned "skip
 * P-10 here if nothing honest is red server-side" guidance.
 * ============================================================================
 *
 * Chat endpoint contract (probed live):
 *   POST /agents/chat  body { conversationId?, content, kind?, payload? }
 *   → { conversation: {...}, newMessages: [ {role:"user",...}, {role:"assistant",...} ] }
 *   Omitting conversationId starts a new conversation server-side.
 */
import { anonymous, type ApiSession, contractor } from "./helpers/api";

// ---------------------------------------------------------------------------
// P-20 — starter chips (client-side; no server-side "identical reply" defect)
// ---------------------------------------------------------------------------
describe("P-20 starter-chip routing (server side)", () => {
  // WHY SKIPPED (curl-grounded, 2026-08-18):
  //   The four starter chips are NOT chat sends. AsstChat.tsx:4296-4325 wires
  //   each chip's onClick to a LOCAL flow — knownPrice→startKnownPriceFlow,
  //   helpPrice→startHelpMePriceFlow, quickQuote→startKnownPriceFlow (dup),
  //   invoiceDone→startInvoiceFlow — none of which POST to /agents/chat.
  //   And POSTing the chip LABELS to /agents/chat does NOT reproduce the
  //   defect: the stub LLM echoes each label distinctly, e.g.
  //     POST /agents/chat {content:"Conozco el trabajo, ayúdame a ponerle precio."}
  //       → assistant "(stub) Conozco el trabajo, ayúdame a ponerle precio."
  //   (and for a brand-new user the first turn runs ONBOARDING, e.g.
  //     → "¡Mucho gusto, Nuevo! ¿Y cómo se llama tu negocio?").
  //   So the four server replies are already distinct and the facturar one
  //   already contains "factur" — a server-side "not-all-identical / mentions
  //   factur" assertion PASSES today (a green test — forbidden here).
  //
  //   P-20's red is the client routing (unit: starter-chips.ts chipIntent/
  //   chipReply; e2e: each chip → its own intent-appropriate bubble).
  it.skip("P-20 the four chips yield distinct, intent-appropriate replies (client-side; no server red)", async () => {
    // Ready harness for when/if chip intents ever route server-side.
    const s: ApiSession = await contractor("+15125553010");
    const labels = [
      "Sé mi precio, redáctalo.",
      "Conozco el trabajo, ayúdame a ponerle precio.",
      "Solo dame una cotización rápida.",
      "Trabajo terminado, necesito facturar.",
    ];
    const replies: string[] = [];
    for (const content of labels) {
      const { body } = await s.post("/agents/chat", { content });
      const asst = (body.newMessages ?? []).find((m: any) =>
        m.role === "assistant"
      );
      replies.push(String(asst?.content ?? ""));
    }
    expect(new Set(replies).size).toBe(labels.length);
    expect(replies[3]).toMatch(/factur/i);
    expect(replies[3]).not.toMatch(/cotiz/i);
  });
});

// ---------------------------------------------------------------------------
// P-10 — bounded chat turn (unobservable via HTTP under the stub LLM)
// ---------------------------------------------------------------------------
describe("P-10 chat-turn timeout (server side)", () => {
  // WHY SKIPPED (curl-grounded): the timeout defect lives in the OpenAI adapter
  // (openai/mod.ts:80-101 — chat.completions.create with SDK defaults, no
  // AbortSignal), which is only active with AGENTS_LLM_CLIENT=openai. The dev
  // stack runs the StubLLMClient, so POST /agents/chat returns in single-digit
  // milliseconds; there is no hung call to bound, and "responds < 35s" is
  // trivially green. Nothing honest is red server-side here. P-10's red lives
  // in the unit file (withChatTimeout) + e2e (spinner/cancel).
  it.skip("P-10 a hung chat turn is bounded to ~30s (needs the real OpenAI client)", async () => {
    // Placeholder harness — meaningful only under AGENTS_LLM_CLIENT=openai with
    // an injected slow fetch. Not runnable against the stub dev stack.
    const s: ApiSession = await contractor("+15125553011");
    const started = Date.now();
    await s.post("/agents/chat", { content: "hola" });
    expect(Date.now() - started).toBeLessThan(35_000);
  });
});

// ---------------------------------------------------------------------------
// P-26 — translate/projection endpoint (structure already sound; no server red)
// ---------------------------------------------------------------------------
describe("P-26 translate/projection endpoint (backend half)", () => {
  // WHY SKIPPED (curl-grounded, 2026-08-18): the endpoint + persistence the
  // instruction points at are ALREADY correct server-side —
  //   1. POST /agents/job-details/translate {texts:[...ES...], to:"en"}
  //      → 200 { texts:[...] } SAME length + order. Under the stub LLM it
  //      cannot produce English (the stub echoes "(stub){...}", JSON-parse
  //      fails, TranslateBullets falls back to the originals), so asserting the
  //      output is *English* would be red FOREVER in dev (LLM content quality,
  //      which the caveat forbids asserting), never green-after-fix.
  //   2. descriptionByLang round-trips through the quote entity already:
  //      POST /quotes {...,descriptionByLang:{es,en}} then GET /quotes/:id
  //      returns descriptionByLang:{es,en} verbatim (quote DTO field exists).
  //   So the only honest structural assertions here are GREEN today.
  //
  //   P-26's red is the preview projection + the "Click here to send…" label —
  //   both e2e (assistant-experience.cy.ts): toggling the preview to EN must
  //   render the EN descriptionByLang and the send button must not read
  //   "Click here"/"Haz clic aquí".
  it.skip("P-26 translate ES→EN returns EN descriptionByLang (blocked: stub can't translate)", async () => {
    const s: ApiSession = await contractor("+15125553012");
    const { status, body } = await s.post("/agents/job-details/translate", {
      texts: [
        "Reparar la cerca del patio trasero",
        "Instalar tres postes nuevos",
      ],
      to: "en",
    });
    expect(status).toBe(200);
    expect(Array.isArray(body.texts)).toBe(true);
    expect(body.texts).toHaveLength(2);
    // The desired end-state — real English out — is unassertable under the stub
    // (would assert LLM content quality). Left here as the shape the green fix
    // must preserve when a real/deterministic translator is wired.
    expect(body.texts.join(" ")).toMatch(/fence|post|repair|install/i);
  });

  it.skip("P-26 descriptionByLang persists on the quote (already GREEN — kept as a contract guard)", async () => {
    const s: ApiSession = await contractor("+15125553013");
    const cust = await s.post("/customers", {
      name: "Maria Test",
      email: "maria.jest@blackhole.postmarkapp.com",
      phoneNumber: "+15125553014",
    });
    const q = await s.post("/quotes", {
      customerId: cust.body.id,
      jobName: "Cerca",
      summary: "Reparar cerca",
      description: "Reparar la cerca del patio",
      descriptionByLang: {
        es: "Reparar la cerca del patio",
        en: "Repair the backyard fence",
      },
      lineItems: [{
        description: "Cerca",
        quantity: 1,
        unit: "job",
        price: 55000,
      }],
      estimatedTotal: 55000,
    });
    const got = await s.get(`/quotes/${q.body.id}`);
    expect(got.body.descriptionByLang?.en).toBe("Repair the backyard fence");
  });
});

// Keep the imports referenced so unused-import lint stays quiet in the skips.
void anonymous;
