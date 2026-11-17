/**
 * REQ-690 (2026-11-12), Raphael: "fix every issue the demo found, loop until
 * there are none" — demo cycle 5, issue p18-3a: "'Open as customer' vs 'View
 * as customer' label mismatch".
 *
 * Root cause (RCA at 2444608a): one action — open /q/<id> (or /co/<id>) the
 * way the customer sees it — carried three labels: the chat's customer-link
 * row said "Open as customer" (REQ-571), the Send ▾ menu said "Preview as
 * customer" (REQ-570), and the /quotes panel, quote card and CO ledger row
 * said "View as customer". These cases pin every key to one label.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const load = (lang: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "lang", `${lang}.json`), "utf8"));

const KEYS = [
  "asstChat.customerLink.open",
  "asstChat.preview.menuPreview",
  "quoteCard.back.viewAsClient",
  "quotesPage.open.viewAsClient",
  "quotes.ledger.coViewAsCustomer",
];

const EXPECTED: Record<string, { label: string; co: string }> = {
  en: { label: "View as customer", co: "View {number} as customer" },
  es: { label: "Ver como cliente", co: "Ver {number} como cliente" },
};

describe.each(Object.keys(EXPECTED))(
  "REQ-690 one 'view as customer' label (%s)",
  (lang) => {
    const dict = load(lang);
    it.each(KEYS)(`REQ-690 ${lang} %s reads the shared label`, (key) => {
      expect(dict[key]).toBe(EXPECTED[lang].label);
    });

    it(`REQ-690 ${lang} every view-as-customer key stays equal`, () => {
      expect(new Set(KEYS.map((k) => dict[k])).size).toBe(1);
    });

    it(`REQ-690 ${lang} the chat's change-order link uses the same verb`, () => {
      expect(dict["asstChat.changeOrderLink.open"]).toBe(EXPECTED[lang].co);
    });
  },
);
