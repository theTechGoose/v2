/**
 * Review-card "Job details" rows (REQ-237, demo issue M17).
 *
 * The assistant's review/send card shows the scope of work under "Job
 * details". It is read from the quote's description in the preview
 * language, then the lock-quote card's copy, then the stored description,
 * followed by the quote's line items with their amounts (REQ-1049) — for a
 * chat-drafted quote with no description, the line items alone (REQ-237).
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
  // The description's scope lines come first, without amounts.
  const rows: ReviewJobDetailRow[] = splitDetailLines(description).map((
    text,
  ) => ({ text }));
  // REQ-1049 (q2-34): the priced lines ALWAYS follow, each with its amount —
  // the customer /q (quote-doc.tsx) lists quote.lineItems whether or not the
  // quote has a job-details description, so the owner's preview must too.
  // REQ-237: a chat-drafted quote (no description) is just its line items.
  // A line that only repeats a description line is not listed twice: its
  // amount goes onto that description row.
  const byText = new Map<string, ReviewJobDetailRow>();
  for (const r of rows) {
    const key = r.text.toLowerCase();
    if (!byText.has(key)) byText.set(key, r);
  }
  for (const li of input.lineItems ?? []) {
    const text = (li.description ?? "").trim();
    if (!text) continue;
    const priced = typeof li.amountCents === "number" &&
      Number.isFinite(li.amountCents);
    const dup = byText.get(text.toLowerCase());
    if (dup && dup.amountCents === undefined) {
      if (priced) dup.amountCents = li.amountCents as number;
      byText.delete(text.toLowerCase());
      continue;
    }
    rows.push(
      priced ? { text, amountCents: li.amountCents as number } : { text },
    );
  }
  return rows;
}
