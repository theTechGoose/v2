/**
 * REQ-487 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m58: the public page of a manual
 * (standalone) invoice showed no "Bill to / Facturar a" and "From / De"
 * blocks and no line-item table — /i drew both only for a quote-linked
 * ("rich") invoice.
 *
 * Renders the real /i/[id] route over a stubbed in-process backend
 * (globalThis.__backendFetch, the same hook Deno Deploy uses) and reads the
 * invoice document's DOM.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import PublicInvoice from "../routes/i/[id].tsx";

type Json = Record<string, unknown>;

const contractor = {
  name: "Deb Kowalski",
  businessName: "Sparkle Home Cleaning",
  email: "deb@example.com",
  commsLanguage: "en",
};

async function renderInvoice(
  body: Json,
  lang: "en" | "es" = "en",
): Promise<Element> {
  (globalThis as { __backendFetch?: unknown }).__backendFetch = () =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  try {
    const page = PublicInvoice as unknown as (
      ctx: unknown,
    ) => Promise<VNode>;
    const vnode = await page({
      params: { id: String(body.id) },
      req: new Request(`http://localhost/i/${body.id}?lang=${lang}`),
      state: {},
    });
    const html = renderToString(vnode);
    const doc = new DOMParser().parseFromString(html, "text/html")!;
    const article = doc.querySelector("[data-cy=invoice-doc]");
    assert(article, "the invoice document rendered");
    return article as Element;
  } finally {
    delete (globalThis as { __backendFetch?: unknown }).__backendFetch;
  }
}

const standalone: Json = {
  id: "inv-standalone-1",
  number: "INV-002",
  version: 1,
  state: "sent",
  status: "sent",
  amount: 300_00,
  contractor,
  customer: { name: "Maria Lopez", email: "maria@example.com" },
  jobDetails: {
    jobName: "Move-out clean",
    lineItems: [
      {
        description: "Deep clean, 3 bedrooms",
        quantity: 1,
        unit: "job",
        price: 240_00,
      },
      { description: "Oven interior", quantity: 2, unit: "each", price: 30_00 },
    ],
  },
};

Deno.test("REQ-487 (demo m58): a standalone invoice shows Bill to (the customer) and From (the contractor)", async () => {
  const doc = await renderInvoice(standalone);
  const parties = doc.querySelector("[data-cy=invoice-parties]");
  assert(parties, "no Bill to / From blocks on a standalone invoice");
  const text = parties.textContent;
  assert(text.includes("Bill to"), text);
  assert(text.includes("Maria Lopez"), text);
  assert(text.includes("From"), text);
  assert(text.includes("Deb Kowalski"), text);
});

Deno.test("REQ-487 (demo m58): a standalone invoice with no line items still shows the parties (Facturar a / De in Spanish)", async () => {
  const { jobDetails: _drop, ...bare } = standalone;
  const doc = await renderInvoice(
    { ...bare, jobDetails: { jobName: "Limpieza" } },
    "es",
  );
  const parties = doc.querySelector("[data-cy=invoice-parties]");
  assert(parties, "no Facturar a / De blocks");
  assert(parties.textContent.includes("Facturar a"), parties.textContent);
  assert(parties.textContent.includes("Maria Lopez"), parties.textContent);
  assert(parties.textContent.includes("De"), parties.textContent);
});

Deno.test("REQ-487 (demo m58): a standalone invoice draws its own line-item table, with no 'Agreement value' card", async () => {
  const doc = await renderInvoice(standalone);
  const rows = [...doc.querySelectorAll("table tbody tr")].map((tr) =>
    (tr as Element).querySelector("td")?.textContent.trim()
  );
  assertEquals(rows, ["Deep clean, 3 bedrooms", "Oven interior"]);
  assert(
    !doc.textContent.includes("Agreement value"),
    "a standalone bill has no agreement",
  );
});

Deno.test("REQ-487 (demo m58): a standalone invoice whose tax makes the amount differ from the lines still shows no 'Agreement value' card", async () => {
  const doc = await renderInvoice({
    ...standalone,
    amount: 324_75,
    subtotalCents: 300_00,
    taxRateBp: 825,
    taxCents: 24_75,
  });
  assertEquals(doc.querySelectorAll("table tbody tr").length, 2);
  assert(!doc.textContent.includes("Agreement value"));
});
