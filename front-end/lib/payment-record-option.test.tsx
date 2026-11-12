/**
 * REQ-587 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M27: the Spanish "Registrar un pago" modal
 * listed "Invoice · María González · $450" (a hard-coded English fallback,
 * jobNameByLang ignored) and "Recibido el" showed 11/12/2026 (a native date
 * input draws the browser locale, not the app language).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { recordOptionLabel } from "./payment-record-option.ts";
import { formatLongDate } from "../../shared/quote-flow/format-helpers.ts";
import PaymentReceivedForm from "../components/PaymentReceivedForm.tsx";

const base = { id: "abcdef1234567890", amount: 45000 };

Deno.test("REQ-587 M27: an invoice with no number and no job name reads 'Factura' in Spanish, never 'Invoice'", () => {
  const es = recordOptionLabel("es", base, "María González");
  assert(!/Invoice/.test(es), `es label leaks English: ${es}`);
  assertStringIncludes(es, "Factura");
  assertStringIncludes(es, "María González");
  assertStringIncludes(es, "$450");
  assertStringIncludes(recordOptionLabel("en", base, "Ann"), "Invoice");
});

Deno.test("REQ-587 M27: the invoice number leads the label, then the job name", () => {
  const label = recordOptionLabel(
    "es",
    { ...base, number: "INV-001", jobName: "Back fence" },
    "María González",
  );
  assertEquals(label, "INV-001 — Back fence · María González · $450");
});

Deno.test("REQ-587 M27: the job name is shown in the app's language (jobNameByLang[lang])", () => {
  const inv = {
    ...base,
    number: "INV-002",
    lang: "en",
    jobName: "Back fence",
    jobNameByLang: { en: "Back fence", es: "Cerca trasera" },
  };
  assertStringIncludes(recordOptionLabel("es", inv, "Ana"), "Cerca trasera");
  assertStringIncludes(recordOptionLabel("en", inv, "Ana"), "Back fence");
});

Deno.test("REQ-587 M27: a stale translation (base entry no longer the jobName) is not shown", () => {
  const inv = {
    ...base,
    lang: "en",
    jobName: "Front gate",
    jobNameByLang: { en: "Back fence", es: "Cerca trasera" },
  };
  assertStringIncludes(recordOptionLabel("es", inv, "Ana"), "Front gate");
});

Deno.test("REQ-587 M27: no customer → an em dash in its slot", () => {
  assertEquals(
    recordOptionLabel("en", { ...base, number: "INV-003" }, undefined),
    "INV-003 · — · $450",
  );
});

function rendered(lang: "en" | "es") {
  const html = renderToString(
    <PaymentReceivedForm
      invoiceId="inv1"
      amountCents={45000}
      lang={lang}
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}

Deno.test("REQ-587 M27: 'Recibido el' shows the picked date in Spanish words next to the native picker", () => {
  const today = new Date().toISOString().slice(0, 10);
  const es = rendered("es").querySelector(
    "[data-cy=pay-received-date-text]",
  ) as Element | null;
  assert(es, "a localized rendering of the date sits by the picker");
  assertEquals(es.textContent.trim(), formatLongDate(today, "es"));
  assertStringIncludes(es.textContent, " de ");
  const en = rendered("en").querySelector(
    "[data-cy=pay-received-date-text]",
  ) as Element;
  assertEquals(en.textContent.trim(), formatLongDate(today, "en"));
});
