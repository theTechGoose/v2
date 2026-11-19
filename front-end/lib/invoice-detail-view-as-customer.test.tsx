/**
 * REQ-1052 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 2, issue q2-40:
 * "Invoice detail panel shows 'View as customer' twice".
 *
 * The detail panel (InvoiceDetail in islands/InvoicesPage.tsx) mounts the
 * shared <InvoiceStageActions> in its dispatch row (REQ-702) without
 * showViewLink={false}, so the component draws "View as customer"
 * (invoice-detail-open) — and the panel's Edit / Discount / … row still ends
 * with its own hand-written REQ-626 link (invoice-detail-view-as-customer).
 * REQ-985 fixed the same duplicate on the card back only.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { InvoiceStageActions } from "../components/InvoiceStageActions.tsx";
import { tFor } from "./i18n.ts";

const SRC = await Deno.readTextFile(
  new URL("../islands/InvoicesPage.tsx", import.meta.url),
);
const ID = "0b6c1d2e-aaaa-4bbb-8ccc-1234567890ab";

/** the InvoiceDetail function's source, start to the next top-level function */
function invoiceDetailSrc(): string {
  const start = SRC.indexOf("function InvoiceDetail(");
  assert(start >= 0, "InvoiceDetail is in islands/InvoicesPage.tsx");
  const end = SRC.indexOf("\nfunction ", start + 1);
  return SRC.slice(start, end < 0 ? undefined : end);
}

/** literal props of each <InvoiceStageActions …/> mount in `src` */
function stageActionsMounts(src: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let at = src.indexOf("<InvoiceStageActions");
  while (at >= 0) {
    const tag = src.slice(at, src.indexOf("/>", at));
    const props: Record<string, unknown> = {};
    for (const m of tag.matchAll(/(\w+)=\{(true|false)\}/g)) {
      props[m[1]] = m[2] === "true";
    }
    // a bare boolean attribute (e.g. `showStageCta`) is true
    for (const m of tag.matchAll(/\n\s*(\w+)\s*(?=\n)/g)) props[m[1]] = true;
    for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) props[m[1]] = m[2];
    out.push(props);
    at = src.indexOf("<InvoiceStageActions", at + 1);
  }
  return out;
}

Deno.test("REQ-1052 (LOOP-007 q2-40): the invoice detail panel lists 'View as customer' exactly once", () => {
  const panel = invoiceDetailSrc();
  const viewLabel = tFor("en", "invoicesPage.back.viewAsCustomer");
  assertEquals(viewLabel, "View as customer");
  assertEquals(tFor("en", "invoicesPage.detail.viewAsCustomer"), viewLabel);

  // the panel's own links labelled "View as customer"
  const own =
    (panel.match(/invoicesPage\.(back|detail)\.viewAsCustomer/g) ?? []).length;

  // plus what each shared <InvoiceStageActions> renders with the panel's props
  let fromComponent = 0;
  for (const props of stageActionsMounts(panel)) {
    const html = renderToString(
      <InvoiceStageActions
        stage="out"
        invoiceId={ID}
        invoiceLang="en"
        lang="en"
        busy={false}
        cyPrefix="invoice-detail"
        showStageCta
        onStageAction={() => {}}
        {...props}
      />,
    );
    const doc = new DOMParser().parseFromString(
      `<div>${html}</div>`,
      "text/html",
    )!;
    fromComponent += [...doc.querySelectorAll("a,button")].filter((el) =>
      el.textContent.trim() === viewLabel
    ).length;
  }
  assertEquals(
    own + fromComponent,
    1,
    `detail panel renders 'View as customer' ${own} time(s) itself + ${fromComponent} via <InvoiceStageActions>`,
  );
});
