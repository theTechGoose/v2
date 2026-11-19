/**
 * REQ-1103 (LOOP-007 cycle 3, q3-30) — "/i accessible text runs a sentence
 * into the amount: 'Tell us how$1,935.15'".
 *
 * The claim section's label on the customer's /i page is a <div> whose
 * children are the label text ("Already paid? Tell us how" when pay buttons
 * are shown, "How would you like to pay?" when not) and, right after it, the
 * <span data-cy="claim-balance"> with the amount. No text node sits between
 * them; only the span's CSS margin-left separates them. Screen readers, copy
 * and paste, and page-text probes get "Tell us how$1,935.15". Same mechanism
 * as REQ-313's "0aperturas".
 */
import { assert, assertMatch } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PublicInvoiceClaim from "../islands/PublicInvoiceClaim.tsx";

function claimLabel(
  acceptedMethods: { method: string; handle?: string }[],
  lang: "en" | "es" = "en",
): string {
  const html = renderToString(
    <PublicInvoiceClaim
      invoiceId="inv-1103"
      acceptedMethods={acceptedMethods}
      status="sent"
      balanceCents={193515}
      lang={lang}
    />,
  );
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")!;
  const amount = doc.querySelector("[data-cy=claim-balance]");
  assert(amount, "the claim form shows the balance");
  const label = amount.parentElement;
  assert(label, "the balance sits inside the claim label");
  return label.textContent;
}

Deno.test("REQ-1103 (LOOP-007 q3-30): with pay buttons, the label text has whitespace between 'Tell us how' and the amount", () => {
  // Venmo with a handle → a pay-link button → "Already paid? Tell us how"
  const text = claimLabel([{ method: "venmo", handle: "@northside" }]);
  assert(text.includes("Tell us how"), `label branch: ${JSON.stringify(text)}`);
  assertMatch(
    text,
    /(^|\s)\$1,935\.15/,
    `label runs into the amount: ${JSON.stringify(text)}`,
  );
});

Deno.test("REQ-1103 (LOOP-007 q3-30): without pay buttons, the label text has whitespace between 'How would you like to pay?' and the amount", () => {
  // cash only → no pay buttons → "How would you like to pay?"
  const text = claimLabel([{ method: "cash" }]);
  assert(
    text.includes("How would you like to pay?"),
    `label branch: ${JSON.stringify(text)}`,
  );
  assertMatch(
    text,
    /(^|\s)\$1,935\.15/,
    `label runs into the amount: ${JSON.stringify(text)}`,
  );
});

Deno.test("REQ-1103 (LOOP-007 q3-30): the Spanish label is separated from the amount too", () => {
  const text = claimLabel([{ method: "cash" }], "es");
  assertMatch(
    text,
    /(^|\s)\$1,935\.15/,
    `label runs into the amount: ${JSON.stringify(text)}`,
  );
  assert(
    !/[A-Za-z?¿]\$1,935\.15/.test(text),
    `label runs into the amount: ${JSON.stringify(text)}`,
  );
});
