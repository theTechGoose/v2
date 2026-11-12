/**
 * REQ-497 (demo-loop cycle 3, m23) — a STANDALONE invoice's text per
 * language. A quote-linked invoice takes its title from the quote's
 * `jobNameByLang`; a standalone one (the /invoices "New invoice" modal, the
 * assistant's "Job done, need to invoice") only had the `jobName` /
 * `description` the contractor typed, so /i?lang=en showed a Spanish title.
 *
 * On create the server fills `jobNameByLang` / `descriptionByLang` (the base
 * language verbatim, the other through TranslateBullets) and stamps `lang`.
 * The base slot doubles as the cache key: a map is only projected while its
 * base entry still equals the current text, so an invoice edited after the
 * translation shows what was typed — never an older translation.
 */

/** The fields this module reads off an invoice. */
export interface InvoiceLangFields {
  lang?: string | null;
  jobName?: string | null;
  description?: string | null;
  jobNameByLang?: Record<string, string> | null;
  descriptionByLang?: Record<string, string> | null;
}

/** A description as the translator sees it: trimmed lines, no blank ones. */
export function descriptionLines(text: string | null | undefined): string[] {
  return (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** The canonical form of a description — the key its cache is stored under. */
export function normalizeDescription(text: string | null | undefined): string {
  return descriptionLines(text).join("\n");
}

/**
 * The per-language maps that are still current for this invoice — each one
 * only when `lang` is set and its base-language entry equals the text the
 * invoice carries now. Readers render `map[lang] ?? jobName`.
 */
export function invoiceTextByLang(inv: InvoiceLangFields): {
  jobNameByLang?: Record<string, string>;
  descriptionByLang?: Record<string, string>;
} {
  const base = inv.lang;
  if (!base) return {};
  const out: {
    jobNameByLang?: Record<string, string>;
    descriptionByLang?: Record<string, string>;
  } = {};
  const name = inv.jobName?.trim();
  if (name && inv.jobNameByLang?.[base]?.trim() === name) {
    out.jobNameByLang = inv.jobNameByLang;
  }
  const desc = normalizeDescription(inv.description);
  if (
    desc && inv.descriptionByLang &&
    normalizeDescription(inv.descriptionByLang[base]) === desc
  ) {
    out.descriptionByLang = inv.descriptionByLang;
  }
  return out;
}
