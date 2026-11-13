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

/** The fields this module reads off a standalone invoice's line item. */
export interface InvoiceLineLangFields {
  description?: string | null;
  descriptionByLang?: Record<string, string> | null;
}

/** REQ-710: a line's per-language text, only while it still describes the
 *  line — `lang` is set and its slot equals the line's text. */
export function lineTextByLang(
  lang: string | null | undefined,
  li: InvoiceLineLangFields | null | undefined,
): Record<string, string> | undefined {
  const text = li?.description?.trim();
  if (!lang || !text || li?.descriptionByLang?.[lang]?.trim() !== text) {
    return undefined;
  }
  return li.descriptionByLang ?? undefined;
}

/**
 * REQ-710 (demo-loop cycle 5, M4, pair 9) — a standalone invoice's line items
 * for the customer's page: each carries its per-language text (filled by
 * TranslateInvoice) while that text still describes the line, else the line
 * as typed with no map. /i reads them through localizeLineItems, so the
 * English invoice no longer shows "Retiro de refrigerador y lavadora" under
 * an English title. The base slot is the cache key, as for the title.
 */
export function invoiceLineItemsByLang<T extends InvoiceLineLangFields>(
  inv: { lang?: string | null },
  items: readonly T[] | null | undefined,
): T[] {
  return (items ?? []).map((li) => {
    const { descriptionByLang: _all, ...rest } = li;
    const current = lineTextByLang(inv.lang, li);
    return (current ? { ...rest, descriptionByLang: current } : rest) as T;
  });
}
