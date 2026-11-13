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

/** "Nov 13, 2026 · 3:08 PM" / "13 nov 2026 · 3:08 p. m." — the viewer's clock. */
export function outboxWhen(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  const day = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  return `${day} · ${formatClockTime(d, lang)}`;
}
