/**
 * REQ-776 — Raphael: "Finish and send should have a review step." Demo-loop
 * cycle dv1, issue d3. The invoice send sheet (REQ-727) is rendered for
 * real (SSR) with the invoice's review: the amount, the line items, who it
 * goes to, the channel(s) and the due date sit above Cancel / Send — in
 * English and in Spanish. Nothing is sent until Send.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import InvoiceSendDialog from "../components/InvoiceSendDialog.tsx";

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html")!;

const REVIEW = {
  totalCents: 72500,
  lines: [
    { description: "Paint gate", quantity: 2, amountCents: 60000 },
    { description: "Primer", quantity: 1, amountCents: 12500 },
  ],
  dueDate: "2026-11-28",
};

function render(
  uiLang: "en" | "es",
  customer: { name?: string; email?: string; phoneNumber?: string } | null = {
    name: "Lucía Romero",
    email: "lr@example.com",
    phoneNumber: "+15125551234",
  },
  review: typeof REVIEW | { totalCents: number; lines: never[] } = REVIEW,
) {
  return parse(renderToString(
    <InvoiceSendDialog
      lang={uiLang}
      invoice={{ id: "inv-1", number: "INV-004", lang: "en" }}
      customer={customer}
      review={review}
      onCancel={() => {}}
      onSend={() => Promise.resolve()}
    />,
  ));
}

const text = (doc: ReturnType<typeof parse>, cy: string) =>
  (doc.querySelector(`[data-cy="${cy}"]`)?.textContent ?? "").replace(
    /\s+/g,
    " ",
  ).trim();

Deno.test("REQ-776 (dv1-d3) the Finish + send review shows the amount, line items, recipient, channels and due date above Cancel / Send", () => {
  const doc = render("en");
  const review = doc.querySelector('[data-cy="send-review"]');
  assert(review, "the review renders inside the send sheet");
  assert(
    doc.querySelector('[data-cy="send-dialog"] [data-cy="send-review"]'),
    "…inside the dialog",
  );
  assertStringIncludes(text(doc, "send-review-amount"), "Amount");
  assertStringIncludes(text(doc, "send-review-amount"), "$725.00");
  const lines = doc.querySelectorAll('[data-cy="send-review-line"]');
  assertEquals(lines.length, 2);
  assertStringIncludes(lines[0].textContent, "Paint gate");
  assertStringIncludes(lines[0].textContent, "2 ×");
  assertStringIncludes(lines[0].textContent, "$600.00");
  assertStringIncludes(lines[1].textContent, "Primer");
  assertStringIncludes(lines[1].textContent, "$125.00");
  const to = text(doc, "send-review-to");
  assertStringIncludes(to, "To");
  assertStringIncludes(to, "Lucía Romero");
  assertStringIncludes(to, "lr@example.com");
  assertStringIncludes(to, "(512) 555-1234");
  assertStringIncludes(text(doc, "send-review-due"), "Due");
  assertStringIncludes(text(doc, "send-review-due"), "Nov 28, 2026");
  // the channel(s): the picker, one checked
  assertEquals(
    doc.querySelectorAll('[data-cy^="send-option-"][aria-checked="true"]')
      .length,
    1,
  );
  assertEquals(text(doc, "send-cancel"), "Cancel");
  assertEquals(text(doc, "send-keep"), "Send");
});

Deno.test("REQ-776 (dv1-d3) the review in Spanish", () => {
  const doc = render("es");
  assertStringIncludes(text(doc, "send-review-amount"), "Monto");
  assertStringIncludes(text(doc, "send-review-amount"), "$725.00");
  assertStringIncludes(text(doc, "send-review-to"), "Para");
  assertStringIncludes(text(doc, "send-review-due"), "Vence");
  assertStringIncludes(text(doc, "send-review-due"), "28");
  assertStringIncludes(text(doc, "send-review-due"), "nov");
  assertStringIncludes(text(doc, "send-review-items"), "Conceptos");
});

Deno.test("REQ-776 (dv1-d3) an amount-only invoice with no due date and no contact still reviews honestly", () => {
  const doc = render("en", null, { totalCents: 5000, lines: [] });
  assertStringIncludes(text(doc, "send-review-amount"), "$50.00");
  assertEquals(doc.querySelectorAll('[data-cy="send-review-line"]').length, 0);
  assertStringIncludes(text(doc, "send-review-due"), "No due date");
  assertStringIncludes(text(doc, "send-review-to"), "No email or phone");
});
