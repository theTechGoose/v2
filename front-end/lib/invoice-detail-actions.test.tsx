/**
 * REQ-702 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m21: "Invoice detail lacks
 * customer name/number and has no link or 'send now'". RCA CONFIRMED /
 * skeptic UPHELD at 2444608a.
 *
 * (a) The flipped card's back ("INVOICE DETAIL $725 · Out") names neither
 *     the customer nor the invoice number.
 * (b) The detail panel's action row had Edit / Discount / Change order /
 *     Delete (+ Payment received) only — a scheduled invoice opened there
 *     could not be sent now, and no surface gave the customer's link.
 * The stage action + customer-link row is ONE shared component
 * (components/InvoiceStageActions.tsx) used by the card and the panel.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { detailStageAction, invoiceWhoLine } from "./invoice-card.ts";
import { InvoiceStageActions } from "../components/InvoiceStageActions.tsx";
import { tFor } from "./i18n.ts";

const ID = "0b6c1d2e-aaaa-4bbb-8ccc-1234567890ab";
const SRC = await Deno.readTextFile(
  new URL("../islands/InvoicesPage.tsx", import.meta.url),
);

function render(
  stage: Parameters<typeof detailStageAction>[0],
  lang: "en" | "es" = "en",
  showStageCta = true,
) {
  const html = renderToString(
    <InvoiceStageActions
      stage={stage}
      invoiceId={ID}
      invoiceLang="es"
      lang={lang}
      busy={false}
      cyPrefix="invoice-detail"
      showStageCta={showStageCta}
      onStageAction={() => {}}
    />,
  );
  return new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")!;
}

Deno.test("REQ-702 m21: the detail panel's stage action — Send now / Finish + send / Send reminder", () => {
  assertEquals(detailStageAction("scheduled")?.kind, "sendNow");
  assertEquals(detailStageAction("drafting")?.kind, "finishSend");
  assertEquals(detailStageAction("out")?.kind, "remind");
  assertEquals(detailStageAction("overdue")?.kind, "remind");
  // claimed / paid: Payment received + the ledger already cover them
  assertEquals(detailStageAction("claimed"), null);
  assertEquals(detailStageAction("paid"), null);
});

Deno.test("REQ-702 m21: the card back names the customer and the number", () => {
  assertEquals(
    invoiceWhoLine({ client: "Marisol Ortega", invoiceRef: "INV-001" }),
    "Marisol Ortega · INV-001",
  );
  assertEquals(
    invoiceWhoLine({ client: "", invoiceRef: "INV-002" }),
    "INV-002",
  );
  // the back head renders it under the amount
  const back = SRC.slice(SRC.indexOf('class="qcard__back-head"'));
  const head = back.slice(0, back.indexOf('class="qcard__back-body"'));
  assert(
    /data-cy="invoice-card-back-who"[\s\S]*invoiceWhoLine\(inv\)/.test(head),
    "qcard__back-head renders invoiceWhoLine(inv) as invoice-card-back-who",
  );
});

Deno.test("REQ-702 m21: a scheduled invoice's panel offers Send now, View as customer and Copy link", () => {
  const doc = render("scheduled");
  const cta = doc.querySelector("[data-cy=invoice-detail-cta-scheduled]");
  assert(cta, "the stage CTA renders");
  assertEquals(
    cta.textContent.trim(),
    tFor("en", "invoicesPage.cta.scheduled"),
  );
  const open = doc.querySelector("a[data-cy=invoice-detail-open]");
  assert(open, "View as customer renders as a link");
  assertEquals(open.getAttribute("href"), `/i/${ID}?lang=es`);
  assertEquals(open.getAttribute("target"), "_blank");
  assertEquals(
    open.textContent.trim(),
    tFor("en", "invoicesPage.detail.viewAsCustomer"),
  );
  const copy = doc.querySelector("[data-cy=invoice-detail-copy-link]");
  assert(copy, "Copy link renders");
  assertEquals(
    copy.textContent.trim(),
    tFor("en", "invoicesPage.detail.copyLink"),
  );
});

Deno.test("REQ-702 m21: drafting → Finish + send, out/overdue → Send reminder, paid → links only", () => {
  assertEquals(
    render("drafting").querySelector("[data-cy=invoice-detail-cta-drafting]")
      ?.textContent.trim(),
    tFor("en", "invoicesPage.cta.drafting"),
  );
  for (const s of ["out", "overdue"] as const) {
    assertEquals(
      render(s).querySelector(`[data-cy=invoice-detail-cta-${s}]`)
        ?.textContent.trim(),
      tFor("en", "invoicesPage.detail.sendReminder"),
      s,
    );
  }
  const paid = render("paid");
  assertEquals(
    paid.querySelectorAll("[data-cy^=invoice-detail-cta-]").length,
    0,
  );
  assert(paid.querySelector("[data-cy=invoice-detail-open]"));
  assert(paid.querySelector("[data-cy=invoice-detail-copy-link]"));
  // the card shares the component for its links only (its own stage CTA stays)
  const links = render("scheduled", "en", false);
  assertEquals(
    links.querySelectorAll("[data-cy^=invoice-detail-cta-]").length,
    0,
  );
});

Deno.test("REQ-702 m21: Spanish labels exist and differ from English", () => {
  const es = render("out", "es");
  const label = es.querySelector("[data-cy=invoice-detail-cta-out]")
    ?.textContent.trim();
  assert(label && label !== tFor("en", "invoicesPage.detail.sendReminder"));
  for (
    const k of [
      "viewAsCustomer",
      "copyLink",
      "linkCopied",
      "copyFailed",
      "sendReminder",
    ]
  ) {
    const key = `invoicesPage.detail.${k}`;
    assert(tFor("en", key) !== key, `en ${key}`);
    assert(tFor("es", key) !== key, `es ${key}`);
    assert(tFor("es", key) !== tFor("en", key), `es ${key} is translated`);
  }
});

Deno.test("REQ-702 m21: the card and the panel both use the one shared component", () => {
  const detail = SRC.slice(
    SRC.indexOf("function InvoiceDetail("),
    SRC.indexOf("function InvoiceCard("),
  );
  const card = SRC.slice(SRC.indexOf("function InvoiceCard("));
  assert(/<InvoiceStageActions[\s\S]*?cyPrefix="invoice-detail"/.test(detail));
  assert(/<InvoiceStageActions[\s\S]*?cyPrefix="invoice-card"/.test(card));
  // one dispatch path: both run send-now / finish / nudge through the hook
  assert(/useInvoiceDispatch\(/.test(detail), "the panel uses the hook");
  assert(/useInvoiceDispatch\(/.test(card), "the card uses the hook");
});
