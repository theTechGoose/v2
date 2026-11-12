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
  hasSecondaryPaymentReceived,
  paymentReceivedTarget,
  revealPayForm,
  scheduledSubline,
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
    "Scheduled to send Nov 26",
  );
  const es = scheduledSubline("2026-11-26", NOW, "es");
  assert(!/2026-11-26/.test(es), es);
  assertEquals(
    es,
    `Programada para enviar ${cardDate("2026-11-26", NOW, "es")}`,
  );
});

Deno.test("REQ-407 p13-f: a scheduled invoice with no date reads a dash", () => {
  assertEquals(scheduledSubline(undefined, NOW, "en"), "Scheduled to send —");
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
