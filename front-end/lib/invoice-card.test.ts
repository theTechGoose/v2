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
