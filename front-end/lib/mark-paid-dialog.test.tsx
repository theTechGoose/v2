/**
 * REQ-930 — Raphael: "when i mark an invoice as paid, i need a modal to put
 * the reference number."
 *
 * Every owner "confirm a customer's claimed payment" button (/invoices card
 * front + back, /payments claim card, the owner's note on /i/:id) opens
 * MarkPaidDialog — Reference number (prefilled with the claim's, focused),
 * one solid "Mark as paid", a ghost Cancel — and only its Mark as paid posts
 * confirm-payment, with `{ reference }`. (Typing a reference and confirming
 * runs in a real browser: e2e/mark-paid-reference — deno-dom cannot mount
 * the dialog.)
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import MarkPaidDialog from "../components/MarkPaidDialog.tsx";
import { confirmPaymentInit } from "./mark-paid.ts";
import { tFor } from "./i18n.ts";

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html")!;

Deno.test("REQ-930: the dialog is a modal with the reference field prefilled with the claim's and focused, a solid Mark as paid and a ghost Cancel", () => {
  const doc = parse(renderToString(
    <MarkPaidDialog
      lang="en"
      initialReference="ZL-930"
      busy={false}
      failed={false}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  ));
  const dialog = doc.querySelector("[data-cy=mark-paid-dialog]") as Element;
  assert(dialog, "the dialog renders");
  assertEquals(dialog.getAttribute("role"), "dialog");
  assertEquals(dialog.getAttribute("aria-modal"), "true");
  assert(
    dialog.textContent.includes(tFor("en", "markPaid.title")),
    "it has its title",
  );
  const input = doc.querySelector("[data-cy=mark-paid-reference]") as Element;
  assertEquals(input.getAttribute("value"), "ZL-930", "prefilled");
  assert(input.hasAttribute("autofocus"), "focused on open");
  assert(
    doc.body.textContent.includes(tFor("en", "markPaid.referenceLabel")),
    "the field is labelled",
  );
  const ok = doc.querySelector("[data-cy=mark-paid-confirm]") as Element;
  const cancel = doc.querySelector("[data-cy=mark-paid-cancel]") as Element;
  assertEquals(ok.textContent.trim(), tFor("en", "markPaid.confirm"));
  assertEquals(cancel.textContent.trim(), tFor("en", "markPaid.cancel"));
  assert(
    /background:\s*var\(--brand-green/.test(ok.getAttribute("style") ?? ""),
    "Mark as paid is the one solid primary",
  );
  assert(
    /background:\s*none/.test(cancel.getAttribute("style") ?? ""),
    "Cancel is a ghost button",
  );
});

Deno.test("REQ-930: a failed confirm shows the error line inside the dialog; busy disables Mark as paid", () => {
  const doc = parse(renderToString(
    <MarkPaidDialog
      lang="es"
      busy
      failed
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  ));
  const err = doc.querySelector("[data-cy=mark-paid-failed]") as Element;
  assertEquals(err.textContent.trim(), tFor("es", "markPaid.failed"));
  assert(
    (doc.querySelector("[data-cy=mark-paid-confirm]") as Element)
      .hasAttribute("disabled"),
  );
  assertEquals(
    (doc.querySelector("[data-cy=mark-paid-reference]") as Element)
      .getAttribute("value"),
    "",
    "no claimed reference → an empty field",
  );
});

Deno.test("REQ-930: confirmPaymentInit posts the reference as JSON with the session", () => {
  const init = confirmPaymentInit("CHK-1042");
  assertEquals(init.method, "POST");
  assertEquals(init.credentials, "include");
  assertEquals(
    (init.headers as Record<string, string>)["content-type"],
    "application/json",
  );
  assertEquals(JSON.parse(init.body as string), { reference: "CHK-1042" });
});

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

Deno.test("REQ-930: every owner confirm button opens MarkPaidDialog, and only the dialog posts confirm-payment (with the reference)", () => {
  for (
    const file of [
      "../islands/InvoicesPage.tsx",
      "../islands/PaymentsPage.tsx",
      "../islands/OwnerClaimReview.tsx",
    ]
  ) {
    const s = src(file);
    assert(
      /import MarkPaidDialog from "\.\.\/components\/MarkPaidDialog\.tsx"/
        .test(s),
      `${file} does not use MarkPaidDialog`,
    );
    assert(/<MarkPaidDialog\b/.test(s), `${file} never renders the dialog`);
    assert(
      /confirmPaymentInit\(/.test(s),
      `${file} posts confirm-payment without the reference`,
    );
  }
  // the old one-click posts are gone
  const inv = src("../islands/InvoicesPage.tsx");
  assert(
    !/confirm-payment`,\s*\{\s*method:\s*"POST",\s*credentials:\s*"include",\s*\}\)/
      .test(inv),
    "InvoicesPage still confirms with a body-less one-click POST",
  );
});

Deno.test("REQ-930: en and es carry every markPaid.* key", () => {
  const en = JSON.parse(src("../../lang/en.json"));
  const es = JSON.parse(src("../../lang/es.json"));
  for (
    const k of [
      "markPaid.title",
      "markPaid.body",
      "markPaid.referenceLabel",
      "markPaid.referencePlaceholder",
      "markPaid.confirm",
      "markPaid.cancel",
      "markPaid.failed",
    ]
  ) {
    assert(en[k], `en is missing ${k}`);
    assert(es[k], `es is missing ${k}`);
    assert(en[k] !== es[k], `${k} is not translated`);
  }
});
