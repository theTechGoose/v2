import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import {
  InvoiceTranslatorPort,
  type TranslateInvoiceRequest,
} from "@paperwork/domain/coordinators/invoice-translator-port/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import { QUOTE_LANGS, type QuoteLang } from "#quote-flow/quote-translations.ts";
import { translatedJobNameCase } from "#quote-flow/job-name.ts";
import {
  descriptionLines,
  invoiceTextByLang,
  normalizeDescription,
} from "#documents/invoice-lang.ts";

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
    if (!name && lines.length === 0) return inv;

    const base: QuoteLang = input.baseLang ??
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

    for (const lang of QUOTE_LANGS) {
      if (lang === base) continue;
      const needName = !!name && !jobNameByLang[lang];
      const needDesc = lines.length > 0 && !descriptionByLang[lang];
      if (!needName && !needDesc) continue;
      const texts = [...(needName ? [name] : []), ...(needDesc ? lines : [])];
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
      if (needDesc) descriptionByLang[lang] = res.texts.slice(k).join("\n");
    }

    const same = (a?: Record<string, string>, b?: Record<string, string>) =>
      JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
    if (
      inv.lang === base && same(inv.jobNameByLang, jobNameByLang) &&
      same(inv.descriptionByLang, descriptionByLang)
    ) {
      return inv;
    }
    const written = await this.invoices.updateIf(
      inv.id,
      (now) =>
        now.userId === input.userId &&
        (now.jobName?.trim() ?? "") === name &&
        normalizeDescription(now.description) === lines.join("\n"),
      { lang: base, jobNameByLang, descriptionByLang },
    );
    return written ?? await this.invoices.getOwned(inv.id, input.userId);
  }
}
