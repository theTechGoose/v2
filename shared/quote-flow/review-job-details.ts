/**
 * Review-card "Job details" rows (REQ-237, demo issue M17).
 *
 * The assistant's review/send card shows the scope of work under "Job
 * details". It is read from the quote's description in the preview
 * language, then the lock-quote card's copy, then the stored description;
 * when there is none (a chat-drafted quote), from the quote's line items.
 *
 * Dependency-free: imported by the front-end island (with .ts) and the Jest
 * unit suite / backend int tests.
 */

export interface ReviewJobDetailRow {
  /** One scope-of-work line, bullet glyph stripped. */
  text: string;
  /** Present when the row came from a priced line item (integer cents). */
  amountCents?: number;
}

export interface ReviewJobDetailsInput {
  previewLang: string;
  /** quote.descriptionByLang — the per-language polished description. */
  descriptionByLang?: Record<string, string | null | undefined> | null;
  /** The lock-quote action_card payload's description. */
  lockedDescription?: string | null;
  /** quote.description — the stored single-language description. */
  description?: string | null;
  /** The review card's line items (lock card's, else the quote's). */
  lineItems?:
    | ReadonlyArray<
      { description?: string | null; amountCents?: number | null }
    >
    | null;
}

/** Split a free-text description into scope lines (same rule as
 *  front-end/lib/format.ts detailLines). */
export function splitDetailLines(
  description: string | null | undefined,
): string[] {
  return (description ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[••\-*]\s*/, "").trim())
    .filter((l) => l.length > 0);
}

export function reviewJobDetails(
  input: ReviewJobDetailsInput,
): ReviewJobDetailRow[] {
  const description = input.descriptionByLang?.[input.previewLang] ??
    input.lockedDescription ?? input.description;
  const lines = splitDetailLines(description);
  if (lines.length > 0) return lines.map((text) => ({ text }));
  // A quote drafted in chat (create_quote) has no description — its scope
  // IS its line items. Show them (with their amounts) rather than "Add the
  // job details" next to a total that came from them.
  const rows: ReviewJobDetailRow[] = [];
  for (const li of input.lineItems ?? []) {
    const text = (li.description ?? "").trim();
    if (!text) continue;
    rows.push(
      typeof li.amountCents === "number" && Number.isFinite(li.amountCents)
        ? { text, amountCents: li.amountCents }
        : { text },
    );
  }
  return rows;
}
