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
