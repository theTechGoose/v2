/**
 * REQ-1118 (LOOP-007 cycle 3, q3-43) — /i/:id printed the heading "Pay online"
 * ("Paga en línea") above a Zelle-only card: brand label, "Send to {handle}",
 * a Copy button. Nothing on that card is paid online; the customer copies a
 * handle and sends money from their own bank. PublicInvoiceClaim's
 * payButtonsBlock() printed payLinks.page.heading whenever payButtons()
 * returned anything, never looking at the button kinds.
 *
 * Contract: "Pay online" / "Paga en línea" heads only `link` buttons (Venmo,
 * Cash App, PayPal.me, the business's own links). A block made only of copy
 * rows (Zelle, a PayPal email) still has a heading, a neutral one.
 */
import { assert } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PublicInvoiceClaim from "../islands/PublicInvoiceClaim.tsx";

type Method = { method: string; handle?: string };

function render(acceptedMethods: Method[], lang: "en" | "es" = "en") {
  const html = renderToString(
    <PublicInvoiceClaim
      invoiceId="inv-1118"
      acceptedMethods={acceptedMethods}
      customerName="Ana Torres"
      balanceCents={650000}
      version={1}
      lang={lang}
      status="sent"
      docNumber="INV-001"
    />,
  );
  return new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
}

const txt = (el: { textContent: string } | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const ZELLE = { method: "zelle", handle: "5125550700" };
const VENMO = { method: "venmo", handle: "@a2z-landscape" };

/** All the text of the pay-buttons block, however the fix groups it. */
function blockText(doc: ReturnType<typeof render>) {
  const block = doc.querySelector("[data-cy='pay-buttons']");
  assert(block, "the Zelle row is shown in the pay-buttons block");
  return txt(block);
}

Deno.test("REQ-1118 (LOOP-007 q3-43): Zelle only — /i's pay block does not say 'Pay online'", () => {
  const doc = render([ZELLE]);
  assert(
    doc.querySelector("[data-cy='pay-zelle-copy']"),
    "the Zelle row with its Copy button is rendered",
  );
  const text = blockText(doc);
  assert(
    !/pay online/i.test(text),
    `only a Zelle send-to card (nothing paid online), yet the block reads: "${text}"`,
  );
});

Deno.test("REQ-1118 (LOOP-007 q3-43): Zelle only, es — /i's pay block does not say 'Paga en línea'", () => {
  const doc = render([ZELLE], "es");
  const text = blockText(doc);
  assert(
    !/paga en l[ií]nea/i.test(text),
    `solo una tarjeta de Zelle (nada se paga en línea), pero el bloque dice: "${text}"`,
  );
});

Deno.test("REQ-1118 (LOOP-007 q3-43): Zelle only — the block still has a heading above the card", () => {
  const doc = render([ZELLE]);
  const block = doc.querySelector("[data-cy='pay-buttons']");
  assert(block, "pay-buttons block");
  const first = block.firstElementChild;
  const heading = txt(first);
  assert(
    first && !first.querySelector("button, a") && heading.length > 0 &&
      !/pay online/i.test(heading),
    `a neutral heading heads the Zelle card, got: "${heading}"`,
  );
});

Deno.test("REQ-1118 (LOOP-007 q3-43): Venmo + Zelle — 'Pay online' still heads the link buttons", () => {
  const doc = render([VENMO, ZELLE]);
  assert(doc.querySelector("[data-cy='pay-venmo']"), "Venmo link button");
  assert(doc.querySelector("[data-cy='pay-zelle-copy']"), "Zelle copy row");
  const text = blockText(doc);
  assert(
    /pay online/i.test(text),
    `a Venmo link is a way to pay online; the block should say "Pay online": "${text}"`,
  );
});
