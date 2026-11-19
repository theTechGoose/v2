/**
 * REQ-984 (LOOP-007 cycle 1, issue q1-60) — the public invoice heading is the
 * placeholder "Project".
 *
 * /i/[id] titled its hero <h1> with the job name, else the job summary, else
 * the i18n key publicInvoice.jobNameFallback ("Project" / "Proyecto"). An
 * amount-only standalone invoice (the New invoice form) carries no job name
 * and no summary, so every such invoice was headed "Project" (QA3, QA5). The
 * heading names the document itself: its first line's description, else the
 * invoice by number ("Invoice INV-001" / "Factura INV-001") — never "Project".
 *
 * Renders the real /i/[id] route over a stubbed in-process backend
 * (globalThis.__backendFetch, the hook Deno Deploy uses), like REQ-487's
 * standalone-invoice-doc.test.tsx.
 *
 *   cd front-end && deno test -A lib/public-invoice-title.test.tsx
 */
import { assert } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import PublicInvoice from "../routes/i/[id].tsx";

type Json = Record<string, unknown>;

async function heroTitle(body: Json, lang: "en" | "es"): Promise<string> {
  (globalThis as { __backendFetch?: unknown }).__backendFetch = (
    req: Request,
  ) =>
    new URL(req.url).pathname.endsWith("/public")
      ? new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      })
      : new Response(JSON.stringify({ available: false }), {
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
    const h1 = doc.querySelector("[data-cy=invoice-doc] h1") ??
      doc.querySelector("h1");
    assert(h1, "the invoice hero <h1> rendered");
    return h1.textContent.trim();
  } finally {
    delete (globalThis as { __backendFetch?: unknown }).__backendFetch;
  }
}

/** an amount-only standalone invoice: no job name, no summary, no lines */
const amountOnly: Json = {
  id: "inv-q1-60",
  number: "INV-001",
  version: 1,
  state: "sent",
  status: "sent",
  amount: 320_00,
  contractor: {
    name: "Deb Kowalski",
    businessName: "Sparkle Home Cleaning",
    commsLanguage: "en",
    sendLanguages: ["en", "es"],
  },
  customer: { name: "Ann Lee", email: "ann@example.com" },
  jobDetails: {},
};

Deno.test("REQ-984 (q1-60): an amount-only invoice's /i heading is never the placeholder 'Project' — it names the invoice 'INV-001'", async () => {
  const h1 = await heroTitle(amountOnly, "en");
  assert(h1 !== "Project", `the heading is the placeholder: "${h1}"`);
  assert(
    h1.includes("INV-001"),
    `the heading names the invoice by its number: "${h1}"`,
  );
});

Deno.test("REQ-984 (q1-60): the same invoice in Spanish is never 'Proyecto' — it names the invoice 'INV-001'", async () => {
  const h1 = await heroTitle(amountOnly, "es");
  assert(h1 !== "Proyecto", `the heading is the placeholder: "${h1}"`);
  assert(
    h1.includes("INV-001"),
    `the heading names the invoice by its number: "${h1}"`,
  );
});

Deno.test("REQ-984 (q1-60): an invoice with one service line and no job name is headed by that line, not 'Project'", async () => {
  const h1 = await heroTitle({
    ...amountOnly,
    jobDetails: {
      lineItems: [{
        description: "Gutter cleaning",
        quantity: 1,
        unit: "job",
        price: 320_00,
      }],
    },
  }, "en");
  assert(h1 !== "Project", `the heading is the placeholder: "${h1}"`);
  assert(
    h1 === "Gutter cleaning",
    `the heading is the line's description: "${h1}"`,
  );
});
