/**
 * REQ-490 (demo-loop cycle 3, issue M19) — previewing the quote in English
 * turned the contractor's own controls English in a Spanish app.
 *
 * The send-review card in islands/AsstChat.tsx rendered its chrome — the
 * status chip, close, "Preview in", the language pills, "Send as", the
 * Quote/Invoice pills, the invoice-mode note, Send… and the caret — with
 * tFor(previewLang, …). previewLang is the DOCUMENT language, so tapping
 * "English" re-rendered the whole card in English. REQ-308 moved only the
 * send dialog to the app language `lang`.
 *
 * The rule pinned here: inside the card, tFor(previewLang, …) is used only
 * for the document's own content (heading, From/For, service address, job
 * details, terms, the term options written into the doc, total); every
 * control is tFor(lang, …).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/AsstChat.tsx"),
  "utf8",
);
const cardStart = src.indexOf('class="quote-review-wrap"');
const cardEnd = src.indexOf("</footer>", cardStart);
const card = src.slice(cardStart, cardEnd);

/** Every tFor(<langVar>, <first arg>) in a slice, args whitespace-normalised. */
function tForArgs(slice: string, langVar: string): string[] {
  const re = new RegExp(
    `tFor\\(\\s*${langVar}\\s*,\\s*("[^"]+"|[A-Za-z_$][\\w.$]*(?:\\[[^\\]]+\\])?(?:\\([^)]*\\))?!?)`,
    "g",
  );
  // Full-line // comments may sit between the language and the key.
  const code = slice.replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(re)].map((m) => m[1].replace(/\s+/g, ""));
}

/** What the customer gets: the only tFor(previewLang, …) first args allowed. */
const DOCUMENT_ARGS = new Set([
  '"asstChat.preview.kind"', // the card heading (the document's kind)
  '"asstChat.preview.from"',
  '"asstChat.preview.for"',
  '"asstChat.preview.serviceAddress"',
  '"asstChat.preview.jobDetails"',
  '"asstChat.preview.jobDetailsEmpty"',
  '"asstChat.preview.terms"',
  '"asstChat.preview.totalDue"',
  "TERM_LABEL_KEYS[t.stepId]", // term labels on the document
  "o.labelKey", // term option values written into the document
  "o.subKey",
  "o.subAmountsKey", // REQ-491 (merged on demo-fixes): the deposit option's $ split, same as o.subKey
]);

/** The contractor's controls named by the RCA — each must follow `lang`. */
const CHROME_ARGS = [
  "threadStatusKey(threadHeader.status)",
  '"asstChat.preview.closePreview"',
  '"asstChat.preview.languageGroup"',
  '"asstChat.preview.previewIn"',
  "SEND_LANG_LABEL_KEYS[lng]",
  '"asstChat.preview.docTypeGroup"',
  '"asstChat.preview.sendAs"',
  '"asstChat.preview.docTypeInvoice"',
  '"asstChat.preview.invoiceModeNote"',
  '"asstChat.preview.translationPending"',
  '"asstChat.preview.translationMissing"',
  '"asstChat.preview.switchCustomer"',
  '"asstChat.preview.editJobDetails"',
  '"asstChat.preview.sending"',
  '"asstChat.preview.sendInvoice"',
  '"asstChat.preview.sendOpen"',
  '"asstChat.preview.chooseSend"',
  '"asstChat.preview.menuCopyLink"',
];

describe("REQ-490 M19 the send-review card's controls speak the app language, not the preview language", () => {
  it("REQ-490 the card and its footer are found in AsstChat.tsx", () => {
    expect(cardStart).toBeGreaterThan(0);
    expect(cardEnd).toBeGreaterThan(cardStart);
    expect(card).toContain("quote-review__langtoggle");
    expect(card).toContain("quote-review__send-main");
  });

  it("REQ-490 tFor(previewLang, …) in the card is only document content", () => {
    const offenders = tForArgs(card, "previewLang").filter((a) =>
      !DOCUMENT_ARGS.has(a)
    );
    expect(offenders).toEqual([]);
  });

  it("REQ-490 the document heading is the ONE preview-language 'kind' — the Send as pill is not", () => {
    expect(
      tForArgs(card, "previewLang").filter((a) =>
        a === '"asstChat.preview.kind"'
      ),
    ).toHaveLength(1);
    const g = card.indexOf('"asstChat.preview.docTypeGroup"');
    const groupEnd = card.indexOf('"asstChat.preview.docTypeInvoice"', g);
    const sendAsGroup = card.slice(g, groupEnd);
    expect(g).toBeGreaterThan(0);
    expect(sendAsGroup).not.toMatch(/tFor\(\s*previewLang/);
    expect(tForArgs(sendAsGroup, "lang")).toContain('"asstChat.preview.kind"');
  });

  it.each(CHROME_ARGS)("REQ-490 control %s renders with tFor(lang, …)", (k) => {
    expect(tForArgs(card, "lang")).toContain(k);
    expect(tForArgs(card, "previewLang")).not.toContain(k);
  });

  it("REQ-490 the toggle still switches the DOCUMENT language (setPreviewLang), and the document still reads previewLang", () => {
    expect(card).toMatch(/setPreviewLang\(lng as "en" \| "es"\)/);
    for (
      const k of ['"asstChat.preview.from"', '"asstChat.preview.totalDue"']
    ) {
      expect(tForArgs(card, "previewLang")).toContain(k);
    }
  });
});
