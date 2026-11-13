/**
 * REQ-407 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 2 (run r561db6d4), issues m30 and p13-f, RCA
 * CONFIRMED/UPHELD at deb85b35:
 *
 * - m30: an out-for-payment invoice card's back row read "Payment received /
 *   Open / Payment received / Mute" — the stage CTA (cta.outReceived) and the
 *   separate data-cy=invoice-payment-received button both rendered.
 * - p13-f: a scheduled card's subline read "Scheduled to send 2026-11-26"
 *   (the raw ISO string) next to "Due Nov 19" (the card's date formatter).
 */
import { assert, assertEquals } from "@std/assert";
import {
  cardDate,
  contactFixRequest,
  hasSecondaryPaymentReceived,
  partialSendParts,
  paymentReceivedTarget,
  revealPayForm,
  scheduledSubline,
  sendNowDates,
} from "./invoice-card.ts";
import { tFor } from "./i18n.ts";

const NOW = new Date("2026-11-12T12:00:00");

Deno.test("REQ-407 m30: an out card has no second 'Payment received' — its stage CTA already is one", () => {
  assertEquals(tFor("en", "invoicesPage.cta.outReceived"), "Payment received");
  assertEquals(hasSecondaryPaymentReceived("out"), false);
});

Deno.test("REQ-407 m30: an overdue card keeps 'Payment received' beside its Nudge CTA", () => {
  assertEquals(hasSecondaryPaymentReceived("overdue"), true);
  for (const s of ["claimed", "scheduled", "drafting", "paid"] as const) {
    assertEquals(hasSecondaryPaymentReceived(s), false, s);
  }
});

Deno.test("REQ-407 p13-f: the scheduled subline reads the date like the due date ('Nov 26'), never ISO", () => {
  assertEquals(
    scheduledSubline("2026-11-26", NOW, "en"),
    // REQ-697 (cycle 5, m22): nothing sends it by itself — it is a reminder
    "We'll remind you on Nov 26 to send it",
  );
  const es = scheduledSubline("2026-11-26", NOW, "es");
  assert(!/2026-11-26/.test(es), es);
  assertEquals(
    es,
    `Te recordamos enviarla el ${cardDate("2026-11-26", NOW, "es")}`,
  );
});

Deno.test("REQ-407 p13-f: a scheduled invoice with no date reads a dash", () => {
  assertEquals(
    scheduledSubline(undefined, NOW, "en"),
    "We'll remind you on — to send it",
  );
});

Deno.test("REQ-407: cardDate keeps the card's existing due-date format", () => {
  assertEquals(cardDate("2026-11-19", NOW, "en"), "Nov 19");
  assertEquals(cardDate("2027-01-05", NOW, "en"), "Jan 5, 2027");
  assertEquals(cardDate(undefined, NOW, "en"), "—");
});

// REQ-489 — demo-loop cycle 3, issue p8-pair1-d: "'Payment received' does a
// full page load". On /invoices the card opens the detail in pay mode IN
// PLACE (setOpenId + history.replaceState); only a call from another page
// navigates.
Deno.test("REQ-489 p8-pair1-d: on /invoices, 'Payment received' opens in place and keeps the other params", () => {
  const t = paymentReceivedTarget(
    "https://app.test/invoices?lang=es&open=old&pay=0#top",
    "inv_42",
  );
  assertEquals(t.inPlace, true);
  const u = new URL(t.url, "https://app.test");
  assertEquals(u.pathname, "/invoices");
  assertEquals(u.searchParams.get("open"), "inv_42");
  assertEquals(u.searchParams.get("pay"), "1");
  assertEquals(u.searchParams.get("lang"), "es");
});

Deno.test("REQ-489 p8-pair1-d: from another page, 'Payment received' navigates to the /invoices deep link", () => {
  for (
    const href of [
      "https://app.test/dashboard",
      "https://app.test/invoices-old",
    ]
  ) {
    const t = paymentReceivedTarget(href, "inv 7");
    assertEquals(t.inPlace, false, href);
    assertEquals(t.url, "/invoices?open=inv+7&pay=1", href);
  }
  assertEquals(
    paymentReceivedTarget("https://app.test/invoices/", "a").inPlace,
    true,
  );
});

/* REQ-554 (demo-loop cycle 4, m52): "Enviar ahora" on a scheduled invoice
 * kept the due date its scheduledFor computed (sent Nov 12, scheduled Nov 19
 * + 30 → "Due Dec 19"); a half-delivered send read entirely in red. */

Deno.test("REQ-554 m52: Send now issues a scheduled invoice today — due today + its days to pay", () => {
  assertEquals(
    sendNowDates(
      { netDays: 30, scheduledFor: "2026-11-19", dueDate: "2026-12-19" },
      "2026-11-12",
    ),
    { issuedDate: "2026-11-12", dueDate: "2026-12-12" },
  );
});

Deno.test("REQ-554 m52: Send now with no netDays keeps the schedule's span (scheduledFor → dueDate)", () => {
  // a milestone placeholder: due = scheduledFor + 7, no netDays on file
  assertEquals(
    sendNowDates(
      { scheduledFor: "2026-11-19", dueDate: "2026-11-26" },
      "2026-11-12",
    ),
    { issuedDate: "2026-11-12", dueDate: "2026-11-19" },
  );
  // crosses a month and a year
  assertEquals(
    sendNowDates(
      { scheduledFor: "2027-01-10", dueDate: "2027-02-09" },
      "2026-12-20",
    ),
    { issuedDate: "2026-12-20", dueDate: "2027-01-19" },
  );
});

Deno.test("REQ-554 m52: Send now with neither netDays nor a span only stamps the issue date", () => {
  assertEquals(sendNowDates({}, "2026-11-12"), { issuedDate: "2026-11-12" });
  assertEquals(
    sendNowDates({ dueDate: "2026-12-19" }, "2026-11-12"),
    { issuedDate: "2026-11-12" },
  );
  // a due date before the schedule is no span to keep — never due before issued
  assertEquals(
    sendNowDates(
      { scheduledFor: "2026-11-19", dueDate: "2026-11-10" },
      "2026-11-12",
    ),
    { issuedDate: "2026-11-12", dueDate: "2026-11-12" },
  );
});

Deno.test("REQ-554 m52: a half-delivered send splits into what went (good news) and what failed", () => {
  assertEquals(partialSendParts("es", "text", "noPhone"), {
    went: "Factura enviada por correo",
    failed: "El texto no salió: noPhone",
  });
  assertEquals(partialSendParts("en", "email", "bounced"), {
    went: "Invoice texted",
    failed: "The email didn't go through: bounced",
  });
});

// REQ-552 — demo-loop cycle 4, issue m25: "Payment received form opens
// off-screen (looks like nothing happened)". On desktop the page scroller is
// `.content`, not the window, so the old `globalThis.scrollTo({top:0})` did
// nothing; the pay form must be scrolled into view and its first method
// button focused.
Deno.test("REQ-552 m25: revealPayForm scrolls the pay form into view (block start) and focuses the first method button", () => {
  const calls: string[] = [];
  const first = {
    focus: (o?: FocusOptions) => calls.push(`focus:${o?.preventScroll}`),
  };
  const form = {
    scrollIntoView: (o?: ScrollIntoViewOptions) =>
      calls.push(`scroll:${o?.block}`),
    querySelector: (sel: string) => {
      calls.push(`q:${sel}`);
      return first;
    },
  };
  const root = {
    querySelector: (sel: string) => {
      calls.push(`root:${sel}`);
      return form;
    },
  };
  assertEquals(revealPayForm(root as unknown as ParentNode), true);
  assertEquals(calls, [
    "root:[data-cy=pay-received-form]",
    "scroll:start",
    "q:button[data-cy^=pay-method-]",
    "focus:true",
  ]);
});

Deno.test("REQ-552 m25: revealPayForm is a no-op when the pay form is not mounted", () => {
  const root = { querySelector: () => null };
  assertEquals(revealPayForm(root as unknown as ParentNode), false);
});

Deno.test("REQ-552 m25: InvoicesPage reveals the pay form in an effect keyed on payNonce, never via window.scrollTo", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/InvoicesPage.tsx", import.meta.url),
  );
  const open = src.slice(
    src.indexOf("function openForPayment("),
    src.indexOf("async function refreshInvoices("),
  );
  assertEquals(
    /globalThis\.scrollTo|window\.scrollTo/.test(open),
    false,
    "openForPayment must not scroll the window (.content is the scroller)",
  );
  assertEquals(
    /useEffect\(\(\) => \{[^}]*revealPayForm\(document\)[\s\S]*?\}, \[payNonce\]\)/
      .test(src),
    true,
    "an effect keyed on [payNonce] calls revealPayForm(document)",
  );
});

// REQ-695 — demo-loop cycle 5, issue m55: "'Finish + send' with no contact
// is a dead end". The card's inline "Add email or phone" saves the typed
// contact where the send endpoints read it: the linked customer (PUT
// /api/customers/:id), else the invoice's own bill-to (PUT /api/invoices/:id).
Deno.test("REQ-695 m55: an email typed for a customer's invoice is saved on the customer", () => {
  assertEquals(
    contactFixRequest(" ana@acme.test ", {
      invoiceId: "inv-1",
      customerId: "cus-1",
    }),
    {
      url: "/api/customers/cus-1",
      body: { email: "ana@acme.test" },
      channel: "email",
    },
  );
});

Deno.test("REQ-695 m55: a phone typed for a customer's invoice is saved on the customer", () => {
  assertEquals(
    contactFixRequest("(512) 555-0142", {
      invoiceId: "inv-1",
      customerId: "cus-1",
    }),
    {
      url: "/api/customers/cus-1",
      body: { phoneNumber: "(512) 555-0142" },
      channel: "text",
    },
  );
});

Deno.test("REQ-695 m55: with no customer the contact lands on the invoice's bill-to, keeping its name", () => {
  assertEquals(
    contactFixRequest("ana@acme.test", {
      invoiceId: "inv-1",
      billTo: { name: "Ana Ruiz", address: "1 Main" },
    }),
    {
      url: "/api/invoices/inv-1",
      body: {
        billTo: { name: "Ana Ruiz", address: "1 Main", email: "ana@acme.test" },
      },
      channel: "email",
    },
  );
});

Deno.test("REQ-695 m55: blank or invalid input is refused with a dictionary key, nothing is sent", () => {
  assertEquals(contactFixRequest("  ", { invoiceId: "i" }), {
    error: "invoicesPage.send.addContactInvalid",
  });
  assertEquals(contactFixRequest("ana@", { invoiceId: "i" }), {
    error: "customer.invalidEmail",
  });
  assertEquals(contactFixRequest("555", { invoiceId: "i" }), {
    error: "customer.invalidPhone",
  });
});
