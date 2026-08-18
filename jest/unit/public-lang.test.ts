/**
 * P-12 [PUBLIC] "The money pages ignore localization — /i and /co are
 * English-only."
 *
 * Target: shared/quote-flow/public-lang.ts  (NEW module — intended RED:
 * "Cannot find module" until the green agent creates it)
 *
 * Expected exports:
 *
 *   resolvePublicLang(args: {
 *     cookie?: string | null;   // the RAW Cookie request header
 *     docLang?: string;         // the document's generation language
 *                               //   (contractor.commsLanguage: "en" | "es")
 *     header?: string | null;   // the Accept-Language request header
 *   }): "en" | "es"
 *
 *   Precedence — the visitor's own choice always wins:
 *     1. pm_lang cookie parsed out of `cookie` (only "en"/"es" count; must
 *        survive HTTP/2 comma-joined Cookie headers exactly like
 *        front-end/lib/lang.ts langFromCookie does:
 *        /(?:^|[;,]\s*)pm_lang=(en|es)(?:[;,]|$)/ )
 *     2. docLang ("es" | "en")
 *     3. Accept-Language header (a leading "es" language tag → "es")
 *     4. "en"
 *
 *   moneyPageStrings(lang: "en" | "es"): {
 *     billTo: string;        // en "Bill to"                    es "Facturar a"
 *     amountDue: string;     // en "Amount due"                 es "Monto a pagar"
 *     howToPay: string;      // en "How would you like to pay?" es "¿Cómo quieres pagar?"
 *     iSentIt: string;       // en "I sent it"                  es "Ya lo envié"
 *     approveChange: string; // en "Approve this change"        es "Aprobar este cambio"
 *   }
 *
 * All ES values above ALREADY EXIST in lang/es.json (publicInvoice.billTo,
 * publicInvoice.amountDue, publicInvoiceClaim.howToPay,
 * publicInvoiceClaim.iSentIt, publicChangeOrderActions.approve) — NO new
 * lang keys are needed. The bug is pure wiring: the routes never read the
 * pm_lang cookie.
 *
 * Wiring sites for the green agent:
 *   - front-end/routes/i/[id].tsx — `const es = invoice.contractor
 *     ?.commsLanguage === "es"` ignores the visitor's pm_lang cookie; must
 *     resolve cookie-first like /q (front-end/routes/q/[id].tsx line ~61)
 *     and /c (front-end/routes/c/[id].tsx line ~17) already do.
 *   - front-end/routes/co/[id].tsx — `const lang: Lang =
 *     co?.commsLanguage === "es" ? "es" : "en"` — same fix.
 */
import {
  moneyPageStrings,
  resolvePublicLang,
} from "../../shared/quote-flow/public-lang";

describe("P-12 resolvePublicLang — pm_lang cookie beats the document language", () => {
  it("P-12 pm_lang=es cookie wins over an English document", () => {
    expect(
      resolvePublicLang({ cookie: "pm_lang=es", docLang: "en" }),
    ).toBe("es");
  });

  it("P-12 pm_lang=en cookie wins over a Spanish document", () => {
    expect(
      resolvePublicLang({ cookie: "pm_lang=en", docLang: "es" }),
    ).toBe("en");
  });

  it("P-12 parses pm_lang out of an HTTP/2 comma-joined Cookie header", () => {
    // Deno re-joins per-cookie header fields with ", " — the same trap
    // front-end/lib/lang.ts langFromCookie already handles.
    expect(
      resolvePublicLang({
        cookie: "pm_session=abc123, pm_lang=es",
        docLang: "en",
      }),
    ).toBe("es");
  });

  it("P-12 without a pm_lang cookie the document's language applies", () => {
    expect(
      resolvePublicLang({ cookie: "pm_session=abc123", docLang: "es" }),
    ).toBe("es");
  });

  it("P-12 an unknown pm_lang value is ignored (only en/es exist)", () => {
    expect(
      resolvePublicLang({ cookie: "pm_lang=fr", docLang: "es" }),
    ).toBe("es");
  });

  it("P-12 falls back to the Accept-Language header when cookie and docLang are absent", () => {
    expect(resolvePublicLang({ header: "es-MX,es;q=0.9,en;q=0.5" })).toBe("es");
    expect(resolvePublicLang({ header: "en-US,en;q=0.9" })).toBe("en");
  });

  it("P-12 defaults to English when nothing is known", () => {
    expect(resolvePublicLang({})).toBe("en");
  });
});

describe("P-12 moneyPageStrings — the /i + /co chrome labels are localized", () => {
  const EN = {
    billTo: "Bill to",
    amountDue: "Amount due",
    howToPay: "How would you like to pay?",
    iSentIt: "I sent it",
    approveChange: "Approve this change",
  };
  // Exact values from lang/es.json (they already exist — see header).
  const ES = {
    billTo: "Facturar a",
    amountDue: "Monto a pagar",
    howToPay: "¿Cómo quieres pagar?",
    iSentIt: "Ya lo envié",
    approveChange: "Aprobar este cambio",
  };

  it("P-12 returns the English chrome labels for en", () => {
    expect(moneyPageStrings("en")).toMatchObject(EN);
  });

  it("P-12 returns the Spanish chrome labels for es (grounded in lang/es.json)", () => {
    expect(moneyPageStrings("es")).toMatchObject(ES);
  });

  it("P-12 every Spanish label differs from its English counterpart (no EN leak-through)", () => {
    const en = moneyPageStrings("en");
    const es = moneyPageStrings("es");
    (Object.keys(EN) as Array<keyof typeof EN>).forEach((k) => {
      expect(es[k]).toBeTruthy();
      expect(es[k]).not.toBe(en[k]);
    });
  });
});
