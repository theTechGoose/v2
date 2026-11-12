/**
 * REQ-224 (demo M36 + i18n-formatting-m14) — the payment ticker names the
 * client, the money in dollars, and the method as a word, in the VIEWER's
 * language, formatted at render time so stored rows read correctly too.
 */
import { assertEquals } from "#std/assert";
import type { DomainEvent } from "@core/business/events/mod.ts";
import type { Notification } from "@communication/dto/notification.ts";
import { localizeNotification, notificationL10n } from "./mod.ts";

function ev(
  action: string,
  data: Record<string, unknown>,
): DomainEvent {
  return {
    userId: "u-1",
    entityType: "invoice",
    entityId: "i-1",
    action,
    data,
    timestamp: "2026-11-11T12:00:00.000Z",
  } as DomainEvent;
}

/** What the feed shows: map the event, store it, re-render for the viewer. */
function feedTitle(event: DomainEvent, lang: "en" | "es"): string {
  const l = notificationL10n(event)!;
  const row: Notification = {
    id: "n-1",
    userId: "u-1",
    type: l.type,
    title: "stored",
    titleKey: l.titleKey,
    titleParams: l.titleParams,
    read: false,
    createdAt: "2026-11-11T12:00:00.000Z",
  } as Notification;
  return localizeNotification(row, lang).title;
}

/** A row as already stored by the old code, re-rendered on read. */
function storedTitle(
  titleKey: string,
  titleParams: Record<string, string | number>,
  lang: "en" | "es",
): string {
  return localizeNotification(
    {
      id: "n-1",
      userId: "u-1",
      type: "invoice_paid",
      title: "stored",
      titleKey,
      titleParams,
      read: false,
      createdAt: "2026-11-11T12:00:00.000Z",
    } as Notification,
    lang,
  ).title;
}

Deno.test("REQ-224: a paid event's amountCents renders as dollars with the client's name (es + en)", () => {
  const e = ev("paid", { amountCents: 45000, customerName: "María Pérez" });
  assertEquals(feedTitle(e, "es"), "María Pérez pagó $450");
  assertEquals(feedTitle(e, "en"), "María Pérez paid $450");
});

Deno.test("REQ-224: cents keep their fraction ($1,234.50), never the raw integer", () => {
  const e = ev("paid", { amountCents: 123450, customerName: "Acme" });
  assertEquals(feedTitle(e, "en"), "Acme paid $1,234.50");
});

Deno.test("REQ-224: a row already stored with raw numeric cents re-renders as dollars", () => {
  assertEquals(
    storedTitle("notify.invoice.paidAmount", { amount: 45000 }, "es"),
    "Tu cliente pagó $450",
  );
});

Deno.test("REQ-224: a pre-formatted amount string still passes through untouched", () => {
  assertEquals(
    storedTitle(
      "notify.invoice.paidAmount",
      { name: "Acme", amount: "$1,000" },
      "en",
    ),
    "Acme paid $1,000",
  );
});

Deno.test("REQ-224: a claim names the method as a localized word, never the enum", () => {
  const cases: Array<[string, string, string]> = [
    ["zelle", "por Zelle", "via Zelle"],
    ["venmo", "por Venmo", "via Venmo"],
    ["cashapp", "por Cash App", "via Cash App"],
    ["paypal", "por PayPal", "via PayPal"],
    ["cash", "en efectivo", "in cash"],
    ["check", "con cheque", "by check"],
    ["ach", "por depósito directo", "by direct deposit"],
    ["card", "con tarjeta", "by card"],
    ["other", "por otro medio", "via other"],
  ];
  for (const [method, es, en] of cases) {
    const e = ev("claimed", { method, customerName: "María" });
    assertEquals(
      feedTitle(e, "es"),
      `María dice que pagó ${es} — confirma que lo recibiste`,
    );
    assertEquals(
      feedTitle(e, "en"),
      `María says they paid ${en} — confirm you got it`,
    );
  }
});

Deno.test("REQ-224: a claim row already stored with the raw enum re-renders as the word", () => {
  assertEquals(
    storedTitle(
      "notify.invoice.claimedVia",
      { name: "María", method: "zelle" },
      "es",
    ),
    "María dice que pagó por Zelle — confirma que lo recibiste",
  );
});

// REQ-488 (demo-loop cycle 3, m56/m57): "Didn't get it" on a claimed invoice
// is a feed event of its own — newer than the claim, so the topbar chip
// stops reading "María says they paid via Zelle".
Deno.test("REQ-488: invoice claim_rejected maps to a 'marked as not received' row in both languages", () => {
  const e = ev("claim_rejected", { method: "zelle", customerName: "María Pérez" });
  assertEquals(notificationL10n(e)?.titleKey, "notify.invoice.claimRejectedVia");
  assertEquals(
    feedTitle(e, "es"),
    "Marcaste el pago de María Pérez por Zelle como no recibido",
  );
  assertEquals(
    feedTitle(e, "en"),
    "You marked María Pérez's payment via Zelle as not received",
  );
  const bare = ev("claim_rejected", { customerName: "María Pérez" });
  assertEquals(
    feedTitle(bare, "en"),
    "You marked María Pérez's payment as not received",
  );
  assertEquals(
    feedTitle(bare, "es"),
    "Marcaste el pago de María Pérez como no recibido",
  );
});

// REQ-589 (demo-loop cycle 4, m15): a Spanish quote accepted while the
// contractor reads in English (or the reverse) named the job in the language
// the event happened to carry ("aceptó tu cotización de Furniture Removal").
// The event now carries the per-language job names and the feed picks the
// reader's.
Deno.test("REQ-589 m15: quote accepted names the job in the reader's language", () => {
  const e = {
    userId: "u-1",
    entityType: "quote",
    entityId: "q-1",
    action: "accepted",
    data: {
      customerName: "María",
      jobName: "Furniture Removal",
      jobNameByLang: { en: "Furniture Removal", es: "Retiro de muebles" },
    },
    timestamp: "2026-11-11T12:00:00.000Z",
  } as DomainEvent;
  const es = feedTitle(e, "es");
  const en = feedTitle(e, "en");
  assertEquals(es, "María aceptó tu cotización de Retiro de muebles");
  assertEquals(en, "María accepted your quote for Furniture Removal");
});

// REQ-566 (demo-loop cycle 4, m11): the dashboard's "What we handled today"
// reads this feed, and it only knew customer-side events — an invoice the
// owner issued, a payment the owner recorded and a field job a worker
// finished never showed up, so the panel said "Nothing yet".
Deno.test("REQ-566 (cycle 4, m11): an issued invoice maps to an 'Invoice sent' row in both languages", () => {
  for (const action of ["issued", "sent"]) {
    const e = ev(action, { amountCents: 45000, customerName: "Bob Smith" });
    assertEquals(notificationL10n(e)?.type, "invoice_sent");
    assertEquals(feedTitle(e, "en"), "Invoice for $450 sent to Bob Smith");
    assertEquals(feedTitle(e, "es"), "Factura de $450 enviada a Bob Smith");
  }
  const bare = ev("issued", {});
  assertEquals(feedTitle(bare, "en"), "Invoice sent to your client");
  assertEquals(feedTitle(bare, "es"), "Factura enviada a tu cliente");
});

Deno.test("REQ-566 (cycle 4, m11): a payment the owner recorded maps to a 'Payment recorded' row", () => {
  const e = ev("payment_recorded", {
    amountCents: 142500,
    customerName: "Linda Perez",
  });
  assertEquals(notificationL10n(e)?.type, "invoice_paid");
  assertEquals(feedTitle(e, "en"), "Payment recorded: $1,425 from Linda Perez");
  assertEquals(feedTitle(e, "es"), "Pago registrado: $1,425 de Linda Perez");
});

Deno.test("REQ-566 (cycle 4, m11): a finished field task maps to a 'Job done' row naming the worker", () => {
  const e: DomainEvent = {
    userId: "u-1",
    entityType: "task",
    entityId: "t-1",
    action: "completed",
    data: { customerName: "Ana Torres", task: "Lawn mowing", worker: "Carlos" },
    timestamp: "2026-11-11T12:00:00.000Z",
  };
  assertEquals(notificationL10n(e)?.type, "task_completed");
  assertEquals(
    feedTitle(e, "en"),
    "Carlos finished a job for Ana Torres: Lawn mowing",
  );
  assertEquals(
    feedTitle(e, "es"),
    "Carlos terminó un trabajo para Ana Torres: Lawn mowing",
  );
  const office = { ...e, data: { customerName: "Ana Torres", task: "Lawn mowing" } };
  assertEquals(feedTitle(office, "en"), "Job done for Ana Torres: Lawn mowing");
  assertEquals(
    feedTitle(office, "es"),
    "Trabajo terminado para Ana Torres: Lawn mowing",
  );
});
