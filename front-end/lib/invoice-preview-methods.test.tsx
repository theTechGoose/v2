/**
 * REQ-705 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue m68 "No payment methods on the owner's
 * invoice preview": the owner's /i/:id preview ("you are viewing as the
 * customer") returned early before the accepted methods were drawn, so a
 * signing-created invoice showed no payment methods at all while the real
 * customer saw Zelle / Efectivo. The preview now lists the same methods,
 * read-only (disabled, nothing to claim), so it matches the customer's view.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PublicInvoiceClaim from "../islands/PublicInvoiceClaim.tsx";

const METHODS = [
  { method: "zelle", handle: "z@x.com" },
  { method: "cash" },
];

function claimDoc(
  props: { internal?: boolean; lang?: "en" | "es"; search?: string },
) {
  const html = renderToString(
    <PublicInvoiceClaim
      invoiceId="inv-705"
      acceptedMethods={METHODS}
      status="sent"
      balanceCents={48000}
      {...props}
    />,
  );
  return new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")!;
}

Deno.test("REQ-705 m68: the owner's invoice preview lists the accepted methods the customer sees, read-only", () => {
  const doc = claimDoc({ internal: true, lang: "es" });
  const preview = doc.querySelector("[data-cy=invoice-internal-preview]");
  assert(preview, "the preview box still renders");
  const list = doc.querySelector("[data-cy=invoice-preview-methods]");
  assert(list, "the preview carries the accepted-methods list");
  const chips = [
    ...list.querySelectorAll("[data-cy^=invoice-preview-method-]"),
  ];
  assertEquals(
    chips.map((c) => c.textContent.trim()),
    ["Zelle", "Efectivo"],
    "the same method labels the customer's chips show",
  );
  for (const c of chips) {
    assertEquals(c.tagName, "BUTTON");
    assert(c.hasAttribute("disabled"), "a preview chip cannot be tapped");
  }
  // still no claim chips / claim form for the business's own viewer
  assertEquals(doc.querySelectorAll("[data-cy^=claim-method-]").length, 0);
  assertEquals(doc.querySelector("[data-cy=claim-form]"), null);
});

Deno.test("REQ-705 m68: the preview's method list carries the 'how to pay' heading the customer sees", () => {
  const doc = claimDoc({ internal: true, lang: "en" });
  const list = doc.querySelector("[data-cy=invoice-preview-methods]");
  assert(list);
  assert(
    list.textContent.includes("How would you like to pay?"),
    `heading missing: ${list.textContent}`,
  );
});

Deno.test("REQ-705 m68: the customer's view is unchanged — live claim chips, no preview list", () => {
  const doc = claimDoc({ lang: "en" });
  assertEquals(doc.querySelector("[data-cy=invoice-preview-methods]"), null);
  assert(doc.querySelector("[data-cy=claim-method-zelle]"));
  assert(doc.querySelector("[data-cy=claim-method-cash]"));
});
