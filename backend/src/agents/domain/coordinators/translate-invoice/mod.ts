import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import {
  InvoiceTranslatorPort,
  type TranslateInvoiceRequest,
} from "@paperwork/domain/coordinators/invoice-translator-port/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import {
  QUOTE_LANGS,
  type QuoteLang,
  quoteTextLang,
} from "#quote-flow/quote-translations.ts";
import { translatedJobNameCase } from "#quote-flow/job-name.ts";
import {
  descriptionLines,
  invoiceTextByLang,
  lineTextByLang,
  normalizeDescription,
} from "#documents/invoice-lang.ts";
import { groupVisits } from "#quote-flow/visit-groups.ts";

/**
 * REQ-497 (demo-loop cycle 3, m23) — TranslateInvoice fills a STANDALONE
 * invoice's `jobNameByLang` / `descriptionByLang`, the way TranslateQuote
 * (REQ-264/400) fills a quote's. A standalone invoice (no quote behind it)
 * only had the title and concepts the contractor typed, so the customer's
 * /i?lang=en showed the Spanish "INV-002" title.
 *
 *   - The base language (the caller's word, else the stored `lang`, else
 *     English) is the typed text verbatim — never sent to the model.
 *   - The other language goes through TranslateBullets in ONE call (title +
 *     description lines). A failed call is NOT cached (REQ-264), so the next
 *     run retries and the page shows the typed text meanwhile.
 *   - Idempotent: a language whose cache still matches the current text is
 *     never re-asked; a renamed invoice is translated afresh.
 *   - The write is conditional on the text being unchanged since the read.
 *
 * Quote-linked invoices are left alone: their title comes from the quote.
 * Registers itself on paperwork's InvoiceTranslatorPort so POST /invoices
 * runs it on create.
 *
 * REQ-710 (demo-loop cycle 5, M4) — the line items ride the same batch (pair
 * 9's English invoice had an English title over the Spanish line "Retiro de
 * refrigerador y lavadora"): each line's `descriptionByLang`, its base slot
 * the typed text and the cache key, as for the title. And the base language
 * is the one the invoice was TYPED in (quoteTextLang); the caller's word —
 * the contractor's app language — decides only when the text can't tell.
 */
@Injectable()
export class TranslateInvoice {
  constructor(
    private invoices: InvoiceStore,
    private translator: TranslateBullets,
    port?: InvoiceTranslatorPort,
  ) {
    port?.register((req) => this.run(req));
  }

  async run(input: TranslateInvoiceRequest): Promise<Invoice> {
    const inv = await this.invoices.getOwned(input.invoiceId, input.userId);
    if (inv.quoteId) return inv;
    const name = inv.jobName?.trim() ?? "";
    const lines = descriptionLines(inv.description);
    // REQ-710 (cycle 5, M4): each line item's text, by position — not a
    // batch invoice's visits, which render grouped by address (REQ-173).
    const own = groupVisits(inv.lineItems) ? [] : inv.lineItems ?? [];
    const items = own.map((li) => li?.description?.trim() ?? "");
    if (!name && lines.length === 0 && !items.some(Boolean)) return inv;

    // REQ-710: the language the invoice was typed in, read off its text; the
    // caller's word (the app language), then the stored one, only when the
    // text can't tell.
    const base: QuoteLang = quoteTextLang(inv) ?? input.baseLang ??
      (inv.lang === "es" || inv.lang === "en" ? inv.lang : "en");
    // What is still current — a cache built from older text is dropped.
    const current = inv.lang === base ? invoiceTextByLang(inv) : {};
    const jobNameByLang: Record<string, string> = {
      ...(current.jobNameByLang ?? {}),
    };
    const descriptionByLang: Record<string, string> = {
      ...(current.descriptionByLang ?? {}),
    };
    if (name) jobNameByLang[base] = name;
    if (lines.length) descriptionByLang[base] = lines.join("\n");
    // REQ-710: a line keeps its copies only while they describe its text.
    const itemByLang = own.map((li, i) => {
      const map: Record<string, string> = {
        ...(inv.lang === base ? lineTextByLang(base, li) ?? {} : {}),
      };
      if (items[i]) map[base] = items[i];
      return map;
    });

    for (const lang of QUOTE_LANGS) {
      if (lang === base) continue;
      const needName = !!name && !jobNameByLang[lang];
      const needDesc = lines.length > 0 && !descriptionByLang[lang];
      const needItems = items.flatMap((text, i) =>
        text && !itemByLang[i][lang] ? [i] : []
      );
      if (!needName && !needDesc && needItems.length === 0) continue;
      const texts = [
        ...(needName ? [name] : []),
        ...(needDesc ? lines : []),
        ...needItems.map((i) => items[i]),
      ];
      const res = await this.translator.run({
        userId: input.userId,
        texts,
        from: base,
        to: lang,
      });
      // REQ-264: never cache the originals as a "translation".
      if (!res.translated || res.texts.length !== texts.length) continue;
      let k = 0;
      if (needName) {
        jobNameByLang[lang] = translatedJobNameCase(res.texts[k++], lang);
      }
      if (needDesc) {
        descriptionByLang[lang] = res.texts.slice(k, k + lines.length)
          .join("\n");
        k += lines.length;
      }
      for (const i of needItems) itemByLang[i][lang] = res.texts[k++];
    }

    const same = (a?: Record<string, string>, b?: Record<string, string>) =>
      JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
    const maps = itemByLang.map((m) => Object.keys(m).length ? m : undefined);
    const lineItems = own.map((li, i) => {
      const { descriptionByLang: _old, ...rest } = li;
      return maps[i] ? { ...rest, descriptionByLang: maps[i] } : rest;
    });
    if (
      inv.lang === base && same(inv.jobNameByLang, jobNameByLang) &&
      same(inv.descriptionByLang, descriptionByLang) &&
      own.every((li, i) => same(li.descriptionByLang, maps[i]))
    ) {
      return inv;
    }
    // The lines as typed (no copies): unchanged since the read, or no write.
    const typedLines = (all: Invoice["lineItems"]) =>
      JSON.stringify(
        (all ?? []).map(({ descriptionByLang: _m, ...rest }) => rest),
      );
    const written = await this.invoices.updateIf(
      inv.id,
      (now) =>
        now.userId === input.userId &&
        (now.jobName?.trim() ?? "") === name &&
        normalizeDescription(now.description) === lines.join("\n") &&
        typedLines(now.lineItems) === typedLines(inv.lineItems),
      {
        lang: base,
        jobNameByLang,
        descriptionByLang,
        ...(own.length ? { lineItems } : {}),
      },
    );
    return written ?? await this.invoices.getOwned(inv.id, input.userId);
  }
}
