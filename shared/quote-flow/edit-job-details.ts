/**
 * REQ-400 (demo-loop cycle 2: M5, M21) — what the review card's "Edit job
 * details" pencil hands the job picker.
 *
 * M5: the pencil seeded the picker with the rows the card was SHOWING — the
 * preview language's (`descriptionByLang[previewLang]`). With the toggle on
 * Español those were Spanish, and applyJobOption stores the picked card's
 * lines as the app-language description, so the English preview read three
 * Spanish bullets and then the English ones the contractor added. The seed is
 * now the quote's OWN text: `description` (the base text, REQ-333), else the
 * lock card's copy of it, else the line items' own (untranslated) text.
 *
 * M21: the regeneration read the current bullets alone (a third of the job,
 * after the model split it), so every regenerated option reworded the same
 * three items. It now reads the message the contractor typed for the job AND
 * the current lines.
 *
 * Dependency-free: imported by the island (with .ts) and the Jest unit suite.
 */
import { splitDetailLines } from "./review-job-details.ts";

export interface EditJobDetailsSeedInput {
  /** quote.description — the job details in the quote's own language. */
  description?: string | null;
  /** The lock card's copy of the description (same language). */
  lockedDescription?: string | null;
  /** The quote's line items, their own (base-language) text. */
  lineItems?: ReadonlyArray<{ description?: string | null }> | null;
  /** The message the contractor typed for this job (draft.originalRaw). */
  originalRaw?: string | null;
  /** The summary / job name, when there are no lines at all. */
  fallback?: string | null;
}

export interface EditJobDetailsSeed {
  /** The current card's lines, in the quote's own language. */
  lines: string[];
  /** What the alternatives are regenerated from. */
  raw: string;
}

export function editJobDetailsSeed(
  input: EditJobDetailsSeedInput,
): EditJobDetailsSeed {
  let lines = splitDetailLines(input.description);
  if (lines.length === 0) lines = splitDetailLines(input.lockedDescription);
  if (lines.length === 0) {
    lines = (input.lineItems ?? [])
      .map((li) => (li?.description ?? "").trim())
      .filter((t) => t.length > 0);
  }
  const current = lines.join("\n");
  const typed = (input.originalRaw ?? "").trim();
  let raw: string;
  if (typed && current && typed !== current) raw = `${typed}\n\n${current}`;
  else raw = typed || current || (input.fallback ?? "").trim();
  return { lines, raw };
}
