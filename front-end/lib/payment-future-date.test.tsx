/**
 * REQ-943 — LOOP-007 cycle 1, issues q1-8 / q1-9. Raphael: "test every
 * single aspect of this application … one Opus agent per issue to do root
 * cause analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * q1-8: the Registrar pago dialog accepted "Recibido el" = 2027-06-01 (today
 * 2026-11-19), stored it, closed the invoice and emailed the customer
 * "PAGADA 1 de junio de 2027". `validatePaymentReceived` only checked that the
 * date was a YYYY-MM-DD; the date input had no `max`. A payment can't be
 * received after today (the business's local day): the form refuses it with
 * its own reason, the date picker stops at today, and the server's 422
 * `future_date` reads as the same localized reason.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import {
  paymentErrorText,
  validatePaymentReceived,
} from "./payment-received.ts";
import { ApiError } from "./api.ts";
import { tFor } from "./i18n.ts";
import PaymentReceivedForm from "../components/PaymentReceivedForm.tsx";

/** the local calendar day `n` days from now, YYYY-MM-DD */
function localDay(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const KEY = "invoicesPage.pay.errFutureDate";

Deno.test("REQ-943 (q1-8): a received date after today is refused with errFutureDate — tomorrow, +200 days, the QA's 2027-06-01, 2099-01-01", () => {
  for (const date of [localDay(1), localDay(200), "2027-06-01", "2099-01-01"]) {
    const r = validatePaymentReceived({
      method: "zelle",
      dollars: "1250",
      date,
    });
    assertEquals(r, { ok: false, errKey: KEY }, `date=${date}`);
  }
});

Deno.test("REQ-943 (q1-8): today and earlier days still record", () => {
  for (const date of [localDay(0), localDay(-1), localDay(-60)]) {
    const r = validatePaymentReceived({ method: "cash", dollars: "65", date });
    assert(r.ok, `date=${date} → ${JSON.stringify(r)}`);
  }
});

Deno.test("REQ-943 (q1-8): the future-date reason is worded in both dictionaries", () => {
  const en = tFor("en", KEY);
  const es = tFor("es", KEY);
  assertNotEquals(en, KEY, "en carries the string");
  assertNotEquals(es, KEY, "es carries the string");
  assertNotEquals(en, es, "es is translated");
});

Deno.test("REQ-943 (q1-8): the server's 422 future_date shows as the same localized reason, not the raw code", () => {
  for (const lang of ["en", "es"] as const) {
    assertEquals(
      paymentErrorText(lang, new ApiError(422, { error: "future_date" })),
      tFor(lang, KEY),
      lang,
    );
  }
});

Deno.test("REQ-943 (q1-8): the rendered date input stops at today (max = today's local day)", () => {
  const html = renderToString(
    <PaymentReceivedForm
      invoiceId="inv1"
      amountCents={125000}
      lang="es"
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const date = doc.querySelector("[data-cy=pay-received-date]") as
    | Element
    | null;
  assert(date, "the date input renders");
  assertEquals(date.getAttribute("max"), localDay(0));
});
