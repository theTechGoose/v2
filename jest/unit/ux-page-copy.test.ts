/**
 * UX audit (ux-problems.md) — pure/dict contracts for the PAGES slice.
 * Phones used in assertions: +15125556550 / 5125556551 (slice F block
 * +15125556500–6599; no live users are touched — this file is pure).
 *
 * UX-16 [I18N] `/quotes` browser-tab title is English ("Quotes · Paperwork
 *   Monster") in the ES UI while dashboard/invoices/settings/payments/clients
 *   are localized.
 *   Mechanism note (read before pinning): shared/quote-flow/site-meta.ts is
 *   the MARKETING social-meta contract (og:/twitter: for "/" + "/landing") —
 *   the app-tab titles do NOT flow through it. Every localized dashboard-area
 *   route resolves its title from the flat dictionaries:
 *     front-end/routes/dashboard/index.tsx:49  tFor(lang,"dashboardPage.docTitle")
 *     front-end/routes/invoices/index.tsx:46   tFor(lang,"invoicesPage.docTitle")
 *     front-end/routes/settings/index.tsx:45   tFor(lang,"settingsRoute.docTitle")
 *     front-end/routes/payments/index.tsx:45   tFor(lang,"paymentsRoute.docTitle")
 *     front-end/routes/clients/index.tsx:45    tFor(lang,"clientsRoute.docTitle")
 *   The offender hardcodes English instead:
 *     front-end/routes/quotes/index.tsx:19     <title>Quotes · Paperwork Monster</title>
 *   Contract pinned here: a `quotesPage.docTitle` key must exist in BOTH
 *   dictionaries (ES value contains "Cotizaciones"), and the green agent must
 *   wire front-end/routes/quotes/index.tsx:19 through tFor exactly like the
 *   sibling routes. No site-meta.ts extension is needed — extending it would
 *   invent a second title mechanism beside the one the app already uses.
 *   RED today: the key does not exist in either dictionary.
 *
 * UX-18 [COPY] Truncation without ellipsis. The quote summary cuts mid-phrase
 *   ("Instalación de patio de adoquines 20x15 para la") on the /q subtitle and
 *   the /quotes open panel. The cut happens at CREATION time — both assistant
 *   coordinators clamp the summary to 8 words and drop the rest silently:
 *     backend/src/agents/domain/coordinators/generate-job-options/mod.ts:204-208
 *       (clampSummary: words.slice(0, 8).join(" ") — no ellipsis)
 *     backend/src/agents/domain/coordinators/polish-job-details/mod.ts:126-130
 *       (duplicate clampSummary)
 *     backend/src/agents/domain/coordinators/polish-job-details/mod.ts:152
 *       (fallback: firstLine.split(/\s+/).slice(0, 8).join(" ") — no ellipsis)
 *   Live-stack proof (curl, 2026-08-19):
 *     POST /api/agents/job-details/polish {"raw":"Instalación de patio de
 *     adoquines 20x15 para la familia Nguyen con base de grava compactada"}
 *     → {"summary":"Instalación de patio de adoquines 20x15 para la", …}
 *   NEW shared contract (intended red: "Cannot find module"):
 *     shared/quote-flow/summary-clamp.ts
 *       export function clampSummary(raw: string, maxWords?: number): string
 *     Semantics (pure, deterministic):
 *       - whitespace runs collapse to single spaces; input is trimmed;
 *       - maxWords defaults to 8;
 *       - ≤ maxWords words → returned unchanged, NO ellipsis appended;
 *       - > maxWords words → the first maxWords words joined by single spaces
 *         with "…" (U+2026) appended directly to the last word — a truncated
 *         summary is always visibly truncated, never a silent mid-phrase cut;
 *       - idempotent (an already-clamped value passes through unchanged).
 *     Wiring sites for the green agent: replace the three private cut sites
 *     listed above with this one shared helper (the FE renders the stored
 *     summary verbatim — /q route front-end/routes/q/[id].tsx:175 and the
 *     open panel front-end/islands/QuotesPage.tsx:174 — so fixing the writers
 *     fixes both surfaces; the e2e half lives in cypress/e2e/ux-quotes-page.cy.ts).
 *
 * UX-15 [DOCS] Raw unformatted phones on the document preview. HONESTY: the
 *   shared formatter ALREADY exists and is correct —
 *   shared/quote-flow/format-helpers.ts:66 formatPhoneDisplay() — and the
 *   public documents already use it (/c + /i via PartyCard,
 *   front-end/components/doc-parts.tsx:214-222; /q footer,
 *   front-end/routes/q/[id].tsx:365-371). The REAL red is the assistant
 *   preview composer, which renders the raw strings:
 *     front-end/islands/AsstChat.tsx:5197  De block  {from.phone}          (raw "+15125556550")
 *     front-end/islands/AsstChat.tsx:5308  Para block {customer.phoneNumber ?? ""} (raw "5125556551")
 *   The unit half below is therefore a clearly-LABELED CONTRACT-PIN (green on
 *   purpose): it freezes the formatter output the wiring fix must reuse. The
 *   red for UX-15 lives in cypress/e2e/ux-doc-preview.cy.ts.
 *
 * UX-35 [/q COPY] "una sola línea de trabajo desglosadas abajo" — the /q intro
 *   sentence hard-codes the FEMININE-PLURAL participle in the wrapper while the
 *   {lines} slot can be singular:
 *     lang/es.json "publicQuote.jobDetails":
 *       "Este estimado cubre {details} — {lines} desglosadas abajo."
 *     lang/es.json "publicQuote.linesOfWork.one": "una sola línea de trabajo"
 *   Composition site: front-end/routes/q/[id].tsx:249-261 (linesPhrase is
 *   substituted into the template — a 1-line-item quote renders
 *   "…una sola línea de trabajo desglosadas abajo", plural participle after a
 *   singular noun). Contract: the composed sentence must agree in number for
 *   BOTH plural forms (e.g. move the participle into each linesOfWork form:
 *   "una sola línea de trabajo desglosada abajo" / "{n} líneas de trabajo
 *   desglosadas abajo"). RED today on the singular composition.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

// Lazy accessor so the missing module only reds the UX-18 tests (pattern from
// format-helpers.test.ts) — "Cannot find module" is the intended red.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const summaryClamp = () => require("../../shared/quote-flow/summary-clamp");

/** Minimal {token} interpolation, mirroring the app's tFor substitution
 *  (same helper as i18n-dictionary-consistency.test.ts). */
function render(tmpl: string, params: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_m, k) => (k in params ? params[k] : `{${k}}`));
}

// ---------------------------------------------------------------------------
// UX-16 — /quotes tab title must be localizable like its sibling routes
// ---------------------------------------------------------------------------

describe("UX-16: /quotes doc title is dictionary-driven like dashboard/invoices", () => {
  it("UX-16: quotesPage.docTitle exists in BOTH dictionaries", () => {
    // RED today: front-end/routes/quotes/index.tsx:19 hardcodes the English
    // <title>; no quotesPage.docTitle key exists in either dictionary.
    expect(typeof en["quotesPage.docTitle"]).toBe("string");
    expect(typeof es["quotesPage.docTitle"]).toBe("string");
  });

  it("UX-16: the ES title says 'Cotizaciones', branded like its siblings", () => {
    // Siblings for shape reference (all live): "Facturas · Paperwork Monster",
    // "Pagos · Paperwork Monster", "Configuración · Paperwork Monster".
    expect(es["quotesPage.docTitle"] ?? "").toContain("Cotizaciones");
    expect(en["quotesPage.docTitle"] ?? "").toContain("Quotes");
  });
});

// ---------------------------------------------------------------------------
// UX-18 — truncated summaries must END WITH AN ELLIPSIS, never cut silently
// ---------------------------------------------------------------------------

describe("UX-18: shared clampSummary appends an ellipsis when it drops words", () => {
  // The exact live-reproduced case (curl evidence in the header): 15 words in,
  // 8 words out, today ending silently at "para la".
  const RAW =
    "Instalación de patio de adoquines 20x15 para la familia Nguyen con base de grava compactada";

  it("UX-18: a >8-word summary ends with '…' (U+2026)", () => {
    const { clampSummary } = summaryClamp();
    const out = clampSummary(RAW);
    expect(out.endsWith("…")).toBe(true);
    // Never the silent cut the audit saw on /q and the open panel:
    expect(out).not.toBe("Instalación de patio de adoquines 20x15 para la");
  });

  it("UX-18: the visible words are the first 8, joined by single spaces", () => {
    const { clampSummary } = summaryClamp();
    expect(clampSummary(RAW)).toBe(
      "Instalación de patio de adoquines 20x15 para la…",
    );
  });

  it("UX-18: an ≤8-word summary passes through untouched — no ellipsis", () => {
    const { clampSummary } = summaryClamp();
    expect(clampSummary("Reparación de cerca trasera")).toBe(
      "Reparación de cerca trasera",
    );
  });

  it("UX-18: whitespace runs collapse before counting words", () => {
    const { clampSummary } = summaryClamp();
    expect(clampSummary("  Pintar   la  sala  ")).toBe("Pintar la sala");
  });

  it("UX-18: clamping is idempotent (already-clamped values are stable)", () => {
    const { clampSummary } = summaryClamp();
    const once = clampSummary(RAW);
    expect(clampSummary(once)).toBe(once);
  });

  it("UX-18: honors an explicit maxWords override", () => {
    const { clampSummary } = summaryClamp();
    expect(clampSummary("uno dos tres cuatro", 3)).toBe("uno dos tres…");
  });
});

// ---------------------------------------------------------------------------
// UX-15 — CONTRACT-PIN (green on purpose): the formatter the fix must reuse
// ---------------------------------------------------------------------------

describe("UX-15: [CONTRACT-PIN — green] formatPhoneDisplay is the one phone renderer", () => {
  // The wiring is the bug, not the formatter: AsstChat.tsx:5197 (De) and
  // :5308 (Para) render raw phone strings while this shared helper already
  // produces the display format the rest of the app uses. These pins freeze
  // the output the green agent must route both preview blocks through; the
  // red assertions live in cypress/e2e/ux-doc-preview.cy.ts.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { formatPhoneDisplay } = require("../../shared/quote-flow/format-helpers");

  it("UX-15: E.164 contractor phone renders as a grouped display number", () => {
    expect(formatPhoneDisplay("+15125556550")).toContain("(512) 555-6550");
  });

  it("UX-15: bare 10-digit customer phone renders as a grouped display number", () => {
    expect(formatPhoneDisplay("5125556551")).toContain("(512) 555-6551");
  });

  it("UX-15: already-formatted input is idempotent", () => {
    const once = formatPhoneDisplay("+15125556550");
    expect(formatPhoneDisplay(once)).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// UX-35 (/q) — number agreement in the composed job-details sentence
// ---------------------------------------------------------------------------

describe("UX-35: /q intro sentence agrees in number for both plural forms", () => {
  // Composed exactly as front-end/routes/q/[id].tsx:249-261 does: the
  // linesOfWork.{one|other} phrase is substituted into publicQuote.jobDetails.
  function composedEs(form: "one" | "other", n: number): string {
    const phrase = render(es[`publicQuote.linesOfWork.${form}`] ?? "", {
      n: String(n),
    });
    return render(es["publicQuote.jobDetails"] ?? "", {
      details: "instalación de patio",
      lines: phrase,
    });
  }

  it("UX-35: the single-line-item sentence never reads 'línea de trabajo desglosadas'", () => {
    // RED today: "…una sola línea de trabajo desglosadas abajo." — the
    // hard-coded plural participle lands after the singular noun.
    expect(composedEs("one", 1)).not.toMatch(/línea de trabajo desglosadas/);
  });

  it("UX-35: the plural sentence never pairs 'líneas' with a singular participle", () => {
    // Agreement must hold in BOTH directions once the participle moves — the
    // plural composition may not regress to "líneas de trabajo desglosada".
    expect(composedEs("other", 3)).not.toMatch(/líneas de trabajo desglosada\b/);
  });

  it("UX-35: the singular sentence still marks the breakdown ('desglosada' survives somewhere)", () => {
    // Guards against "fixing" the agreement by deleting the participle from
    // the singular path entirely while the template still appends it: the
    // composed singular sentence must contain a NUMBER-AGREEING feminine
    // singular 'desglosada' (not the plural).
    const s = composedEs("one", 1);
    expect(s).toMatch(/desglosada\b/);
    expect(s).not.toMatch(/desglosadas\b/);
  });
});
