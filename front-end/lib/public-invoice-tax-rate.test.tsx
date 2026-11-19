/**
 * REQ-1142 — LOOP-007 cycle 3, issue q3-72 [polish/BUG_POLISH]: the tax rate
 * reads "7.00%" on the public invoice /i but "7%" in the email, the PDFs and
 * the owner's send sheet.
 *
 * Unit: renders the real /i/[id] route over a stubbed backend
 * (globalThis.__backendFetch, the hook Deno Deploy uses) and reads the tax
 * row's label. It must carry the same rate string the other surfaces print —
 * shared bpToPercent (owner send sheet) and backend fmtTaxRate (email + both
 * invoice PDFs) — never a padded "7.00%".
 *
 *   cd front-end && deno test -A --no-check lib/public-invoice-tax-rate.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import PublicInvoice from "../routes/i/[id].tsx";
import { bpToPercent } from "../../shared/documents/invoice-form.ts";
import { fmtTaxRate } from "../../backend/src/paperwork/domain/business/doc-render/mod.ts";

type Json = Record<string, unknown>;

async function taxLabel(
  taxRateBp: number,
  lang: "en" | "es",
): Promise<string> {
  const body: Json = {
    id: `inv-q372-${taxRateBp}`,
    number: "INV-001",
    version: 1,
    state: "sent",
    status: "sent",
    amount: 100_00 + Math.round(100_00 * taxRateBp / 10_000),
    subtotalCents: 100_00,
    taxRateBp,
    taxCents: Math.round(100_00 * taxRateBp / 10_000),
    contractor: {
      name: "Luis Ortega",
      businessName: "Ortega Roofing",
      email: "luis@example.com",
      commsLanguage: lang,
    },
    customer: { name: "Rosa Delgado", email: "rosa@example.com" },
    jobDetails: {
      jobName: "Roof repair",
      lineItems: [{
        description: "Roof repair",
        quantity: 1,
        unit: "job",
        price: 100_00,
      }],
    },
  };
  (globalThis as { __backendFetch?: unknown }).__backendFetch = () =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  try {
    const page = PublicInvoice as unknown as (ctx: unknown) => Promise<VNode>;
    const vnode = await page({
      params: { id: String(body.id) },
      req: new Request(`http://localhost/i/${body.id}?lang=${lang}`),
      state: {},
    });
    const doc = new DOMParser().parseFromString(
      renderToString(vnode),
      "text/html",
    )!;
    const article = doc.querySelector("[data-cy=invoice-doc]");
    assert(article, "the invoice document rendered");
    const word = lang === "es" ? "Impuesto" : "Tax";
    const span = [...article.querySelectorAll("span")].find((s) =>
      (s as Element).textContent.trim().startsWith(`${word} (`)
    );
    assert(span, `a "${word} (…)" row on /i (${article.textContent})`);
    return (span as Element).textContent.trim();
  } finally {
    delete (globalThis as { __backendFetch?: unknown }).__backendFetch;
  }
}

for (
  const [bp, want] of [[700, "7%"], [750, "7.5%"], [825, "8.25%"], [
    1000,
    "10%",
  ]] as const
) {
  Deno.test(`REQ-1142 (LOOP-007 q3, q3-72): taxRateBp ${bp} — the email/PDF (fmtTaxRate) and the owner sheet (bpToPercent) both read "${want}"`, () => {
    assertEquals(fmtTaxRate(bp), want, "backend fmtTaxRate");
    assertEquals(`${bpToPercent(bp)}%`, want, "shared bpToPercent");
  });

  for (const lang of ["en", "es"] as const) {
    const word = lang === "es" ? "Impuesto" : "Tax";
    Deno.test(`REQ-1142 (LOOP-007 q3, q3-72): /i with taxRateBp ${bp} (${lang}) reads "${word} (${want})" like the email and the send sheet, never two padded decimals`, async () => {
      const label = await taxLabel(bp, lang);
      assertEquals(
        label,
        `${word} (${want})`,
        `the /i tax label must match the email/PDF/sheet format (got "${label}")`,
      );
    });
  }
}
