/**
 * REQ-322 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issue m36: recording a payment failed with no
 * reason (cleared date → generic "Couldn't record the payment." and no
 * request) and succeeded with no message.
 *
 * The decision is pure: validatePaymentReceived runs method → amount → date,
 * each with its own key, and the date is rejected BEFORE any receivedAt
 * instant is built; paymentErrorText surfaces the server's reason when the
 * body carries one; paymentRecordedText is the success flash.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import {
  paymentErrorText,
  paymentRecordedText,
  validatePaymentReceived,
} from "./payment-received.ts";
import { ApiError } from "./api.ts";
import { tFor } from "./i18n.ts";
import PaymentReceivedForm from "../components/PaymentReceivedForm.tsx";

Deno.test("REQ-322: no method → errMethod, before anything else", () => {
  const r = validatePaymentReceived({ method: null, dollars: "", date: "" });
  assertEquals(r, { ok: false, errKey: "invoicesPage.pay.errMethod" });
});

Deno.test("REQ-322: a missing / zero / garbage amount → errAmount", () => {
  for (const dollars of ["", "0", "-5", "abc"]) {
    const r = validatePaymentReceived({ method: "cash", dollars, date: "" });
    assertEquals(
      r,
      { ok: false, errKey: "invoicesPage.pay.errAmount" },
      `dollars=${JSON.stringify(dollars)}`,
    );
  }
});

Deno.test("REQ-322: a cleared or malformed date → errDate, and no instant is built (the RangeError that used to masquerade as errSave)", () => {
  for (const date of ["", "T12:00:00", "2026-1-5", "yesterday"]) {
    const r = validatePaymentReceived({ method: "cash", dollars: "65", date });
    assertEquals(
      r,
      { ok: false, errKey: "invoicesPage.pay.errDate" },
      `date=${JSON.stringify(date)}`,
    );
  }
  assertEquals(
    tFor("en", "invoicesPage.pay.errDate"),
    "Pick the day you received it.",
  );
  assertEquals(
    tFor("es", "invoicesPage.pay.errDate"),
    "Elige el día en que lo recibiste.",
  );
});

Deno.test("REQ-322: a good triple yields integer cents and a noon-local instant on that day", () => {
  const r = validatePaymentReceived({
    method: "zelle",
    dollars: "65.10",
    date: "2026-11-12",
  });
  assert(r.ok);
  assertEquals(r.cents, 6510);
  assertEquals(r.method, "zelle");
  assertEquals(
    r.receivedAt,
    new Date("2026-11-12T12:00:00").toISOString(),
  );
});

Deno.test("REQ-322: the server's reason is shown when it gives one; the generic line otherwise", () => {
  assertEquals(
    paymentErrorText("en", new ApiError(400, { error: "Invoice is void" })),
    "Invoice is void",
  );
  assertEquals(
    paymentErrorText("en", new ApiError(409, { message: "Already paid" })),
    "Already paid",
  );
  assertEquals(
    paymentErrorText("en", new ApiError(500, "boom")),
    "Couldn't record the payment.",
  );
  assertEquals(
    paymentErrorText("es", new TypeError("fetch failed")),
    "No se pudo registrar el pago.",
  );
});

Deno.test("REQ-322: the success flash names the exact amount in both languages", () => {
  assertEquals(paymentRecordedText("en", 6500), "Payment of $65.00 recorded");
  assertEquals(
    paymentRecordedText("es", 123456),
    "Se registró el pago de $1,234.56",
  );
});

Deno.test("REQ-322: the rendered form's date input is required", () => {
  const html = renderToString(
    <PaymentReceivedForm
      invoiceId="inv1"
      amountCents={6500}
      lang="en"
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const date = doc.querySelector("[data-cy=pay-received-date]") as
    | Element
    | null;
  assert(date, "the date input renders");
  assert(date.hasAttribute("required"), "the date input is required");
  const form = doc.querySelector("[data-cy=pay-received-form]") as Element;
  assert(
    form.hasAttribute("novalidate"),
    "the form validates itself, so the localized reason shows",
  );
});
