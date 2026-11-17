/**
 * REQ-267 (demo issue ai-assistant-p1-noreply) — the text reply for a chat
 * correction that re-drafts an existing quote.
 *
 * A correction ("I'll supply the paint myself, 50% deposit") goes to the LLM,
 * which calls create_quote again and often returns no prose. The coordinator
 * suppresses an empty bubble on card-bearing turns (#36), so the contractor
 * saw the card change with no acknowledgement — and anything create_quote has
 * no field for (the deposit) vanished silently. This builds a short reply
 * from the old and new line items so a revision always says what changed.
 */
import { type Lang, t } from "@core/i18n/mod.ts";

export interface RevisionLine {
  description: string;
  priceCents: number;
}

/** "deposit" / "down payment" / "upfront" (EN) or "anticipo" / "depósito" /
 *  "enganche" / "adelanto" (ES). create_quote carries no deposit field; the
 *  deposit is chosen in the terms wizard's payment step. */
const DEPOSIT_RE =
  /\b(deposit|down\s*payment|up\s*front|upfront|anticipo|dep[oó]sito|enganche|adelanto)/i;

export function asksForDeposit(userText: string): boolean {
  return DEPOSIT_RE.test(userText);
}

/** REQ-585 (demo-loop cycle 4, M4) — "give Derek a second option … so he can
 *  pick one?" / "dale otra opción". A quote has no options: every line on it
 *  is billed. The model re-sent the same lines and the reply said "Updated
 *  the quote." — so an option ask is answered plainly instead. */
const OPTION_RE = new RegExp(
  [
    String
      .raw`(?:second|another|other|2nd|two|three|multiple|different|several)\s+(?:options?|choices?|versions?)`,
    String.raw`alternatives?`,
    String.raw`(?:choose|pick|decide)\s+(?:one|between|which)`,
    String.raw`good[\s,/-]+better[\s,/-]+best`,
    String
      .raw`(?:otra|segunda|dos|tres|varias|distintas|2|3)\s+opci(?:[oó]n|ones)`,
    String.raw`alternativas?`,
    String.raw`(?:para\s+que|que)\s+(?:escoja|elija|escojan|elijan|decida)`,
    String.raw`(?:escoger|elegir|decidir)\s+entre`,
  ].map((p) => String.raw`(?<![\p{L}\d])` + p + String.raw`(?![\p{L}\d])`)
    .join("|"),
  "iu",
);

export function asksForOption(userText: string): boolean {
  return OPTION_RE.test(userText ?? "");
}

function key(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}

function money(cents: number): string {
  const dollars = cents / 100;
  return "$" + dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function total(lines: RevisionLine[]): number {
  return lines.reduce((s, l) => s + l.priceCents, 0);
}

/** One reply line: what was removed, added and repriced, the total when it
 *  moved, and — when the user asked for a deposit — where that gets set. */
export function describeQuoteRevision(
  lang: Lang,
  before: RevisionLine[],
  after: RevisionLine[],
  userText: string,
  /** REQ-585: something besides the lines changed (the summary, the job
   *  details) — then an unchanged set of lines is still "Updated the quote." */
  opts: { otherChange?: boolean } = {},
): string {
  const beforeByKey = new Map(before.map((l) => [key(l.description), l]));
  const afterKeys = new Set(after.map((l) => key(l.description)));

  const changes: string[] = [];
  for (const l of before) {
    if (!afterKeys.has(key(l.description))) {
      changes.push(
        t(lang, "chatCoordinator.revision.removed", {
          item: l.description.trim(),
        }),
      );
    }
  }
  for (const l of after) {
    const old = beforeByKey.get(key(l.description));
    if (!old) {
      changes.push(
        t(lang, "chatCoordinator.revision.added", {
          item: l.description.trim(),
          amount: money(l.priceCents),
        }),
      );
    } else if (old.priceCents !== l.priceCents) {
      changes.push(
        t(lang, "chatCoordinator.revision.repriced", {
          item: l.description.trim(),
          from: money(old.priceCents),
          to: money(l.priceCents),
        }),
      );
    }
  }

  const from = total(before);
  const to = total(after);
  // REQ-585 (M4): a re-draft that changed no line and no total says so —
  // "Updated the quote." over an identical card claimed a change that never
  // happened.
  const parts = [
    changes.length
      ? t(lang, "chatCoordinator.revision.updated", {
        changes: changes.join("; "),
      })
      : from === to && !opts.otherChange
      ? t(lang, "chatCoordinator.revision.noChange")
      : t(lang, "chatCoordinator.revision.updatedNoChange"),
  ];
  if (from !== to) {
    parts.push(
      t(lang, "chatCoordinator.revision.total", {
        from: money(from),
        to: money(to),
      }),
    );
  }
  if (asksForOption(userText)) {
    parts.push(t(lang, "chatCoordinator.revision.noOptions"));
  }
  if (asksForDeposit(userText)) {
    parts.push(t(lang, "chatCoordinator.revision.depositLater"));
  }
  return parts.join(" ");
}
