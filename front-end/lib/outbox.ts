/**
 * REQ-784 — the Outbox page's words (demo-loop cycle dv1, issue d12;
 * Raphael: "And yes to a sent message outbox."). Every email and text that
 * went, or was meant to go, to a customer — from GET /api/outbox
 * (backend/src/communication/entrypoints/outbox-controller). Pure: each
 * label is worded in the page's language from the entry's codes, never from
 * the words stored at send time (those may be in the other language).
 */
import { type Lang, tFor } from "./i18n.ts";
import { formatClockTime } from "../../shared/quote-flow/locale-format.ts";

export type OutboxChannel = "email" | "text";
export type OutboxStatus = "sent" | "not_sent";
export type OutboxKind =
  | "quote"
  | "invoice"
  | "invoicePaid"
  | "changeOrder"
  | "receipt"
  | "signedCopy"
  | "reminder"
  | "reply";

/** One list row (GET /outbox). */
export interface OutboxRow {
  id: string;
  createdAt: string;
  channel: OutboxChannel;
  status: OutboxStatus;
  /** why it didn't go: missing / invalid / fictional / notMobile / optedOut / other */
  reasonCode?: string;
  /** the sender's own words for it (shown only for an unrecognised refusal) */
  reason?: string;
  language: "en" | "es";
  kind: OutboxKind;
  customerId?: string;
  customerName?: string;
  to?: string;
  docId?: string;
  docRef?: string;
  subject?: string;
  /** the subject (email) or first line (text) */
  preview: string;
}

/** One opened message (GET /outbox/:id): the row plus its content as sent. */
export interface OutboxMessage extends OutboxRow {
  /** the email's HTML or the text's words; "" when nothing went */
  body: string;
}

/**
 * REQ-989 (q1-72) — the list of what went to ONE customer, for her page's
 * Messages tab: `GET /outbox?customerId=<id>` (the account's entries sent
 * to her, newest first).
 */
export function customerOutboxPath(customerId: string): string {
  return `/outbox?customerId=${encodeURIComponent(customerId)}`;
}

/** Where a row opens: the Outbox with that message open (`?open=`). */
export function outboxOpenHref(id: string): string {
  return `/messages?open=${encodeURIComponent(id)}`;
}

/** Codes worded as themselves (a text's SmsFailureCode). */
const WORDED = new Set(["invalid", "fictional", "notMobile", "optedOut"]);

/** "Email" / "Text" — "Correo" / "Texto". */
export function outboxChannelLabel(channel: OutboxChannel, lang: Lang): string {
  return tFor(lang, `outbox.channel.${channel === "text" ? "text" : "email"}`);
}

/** The language it went out in, named in the page's language. */
export function outboxLanguageLabel(language: string, lang: Lang): string {
  return tFor(lang, `outbox.lang.${language === "es" ? "es" : "en"}`);
}

/** What it carried: "Quote Q-001", "Orden de cambio CO-001". */
export function outboxWhat(row: OutboxRow, lang: Lang): string {
  const kind = tFor(lang, `outbox.kind.${row.kind}`);
  return row.docRef ? `${kind} ${row.docRef}` : kind;
}

/** "Sent" / "Not emailed" / "Not texted". */
export function outboxStatusLabel(row: OutboxRow, lang: Lang): string {
  if (row.status === "sent") return tFor(lang, "outbox.status.sent");
  return tFor(
    lang,
    row.channel === "text"
      ? "outbox.status.notTexted"
      : "outbox.status.notEmailed",
  );
}

/** Why it didn't go, in the page's language; undefined when it went. */
export function outboxWhy(row: OutboxRow, lang: Lang): string | undefined {
  if (row.status === "sent") return undefined;
  const code = row.reasonCode || "other";
  if (code === "missing") {
    return tFor(
      lang,
      `outbox.why.missing.${row.channel === "text" ? "text" : "email"}`,
    );
  }
  if (WORDED.has(code)) return tFor(lang, `outbox.why.${code}`);
  const raw = row.reason?.trim();
  // a provider's own words say more than "refused" — a lang key never shows
  return raw && !/^sms\.\w+$/.test(raw)
    ? tFor(lang, "outbox.why.otherWith", { reason: raw })
    : tFor(lang, "outbox.why.other");
}

/** An IANA zone Intl accepts, else undefined (the device's zone). */
function validZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/**
 * The day an outbox entry went out — "Nov 13, 2026" / "13 nov 2026" — in the
 * business's zone (REQ-944, REQ-1037), so it flips at the business's
 * midnight, not the device's or UTC's.
 */
export function outboxDay(iso: string, lang: Lang, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  const zone = validZone(timeZone);
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(zone ? { timeZone: zone } : {}),
  }).format(d);
}

/**
 * "Nov 13, 2026 · 3:08 PM" / "13 nov 2026 · 3:08 p. m." — the business's
 * wall clock (REQ-944; REQ-1037 q2-21: the Outbox printed the device's clock
 * while the chat printed the business's). `timeZone` is the account's
 * businessTimezone; without one it falls back to the device's clock.
 */
export function outboxWhen(
  iso: string,
  lang: Lang,
  timeZone?: string,
): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  const zone = validZone(timeZone);
  return `${outboxDay(iso, lang, zone)} · ${
    formatClockTime(d, lang, { timeZone: zone })
  }`;
}
