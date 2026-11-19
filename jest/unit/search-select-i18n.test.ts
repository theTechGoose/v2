/**
 * REQ-987 (LOOP-007 q1, q1-69) — the house search picker (SearchSelect, REQ-136)
 * speaks the form's language. On the Spanish New invoice / Enviar factura form the
 * service picker said "No matches", its × button was labelled "Clear", the overflow
 * footer said "N more — keep typing to narrow it down" and the create row read
 * `+ Add "<name>"`: all hard-coded English in front-end/islands/SearchSelect.tsx,
 * which took no `lang`. Every string must come from the dictionaries
 * (`common.noMatches` + `searchSelect.clear|more|add`) and every real caller must
 * hand the picker its language.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const SRC = "front-end/islands/SearchSelect.tsx";

describe("REQ-987 SearchSelect has no hard-coded English copy", () => {
  const src = read(SRC);

  test("REQ-987 no literal 'No matches' empty row", () => {
    expect(src).not.toMatch(/>\s*No matches\.?\s*</);
  });

  test("REQ-987 the clear button's aria-label is not the literal \"Clear\"", () => {
    expect(src).not.toMatch(/aria-label="Clear"/);
  });

  test("REQ-987 no literal '+ Add' default create label", () => {
    expect(src).not.toMatch(/`\+ Add "/);
  });

  test("REQ-987 no literal 'keep typing to narrow it down' footer, no en-US count", () => {
    expect(src).not.toMatch(/keep typing to narrow it down/);
    expect(src).not.toMatch(/toLocaleString\("en-US"\)/);
  });

  test("REQ-987 SearchSelect takes the language and resolves its copy through tFor", () => {
    expect(src).toMatch(/\blang\??:\s*Lang\b/);
    expect(src).toMatch(/tFor\([^)]*"common\.noMatches"/);
    expect(src).toMatch(/tFor\([^)]*"searchSelect\.clear"/);
    expect(src).toMatch(/tFor\([^)]*"searchSelect\.more"/);
    expect(src).toMatch(/tFor\([^)]*"searchSelect\.add"/);
  });
});

describe("REQ-987 both dictionaries carry the picker's copy", () => {
  const KEYS = [
    "common.noMatches",
    "searchSelect.clear",
    "searchSelect.more",
    "searchSelect.add",
  ];

  test.each(KEYS)("REQ-987 %s exists in en and es, and es is Spanish", (k) => {
    expect(typeof en[k]).toBe("string");
    expect(typeof es[k]).toBe("string");
    expect(es[k]).not.toBe(en[k]);
  });

  test("REQ-987 the count and name placeholders survive in both languages", () => {
    for (const d of [en, es]) {
      expect(d["searchSelect.more"]).toContain("{n}");
      expect(d["searchSelect.add"]).toContain("{name}");
    }
  });
});

describe("REQ-987 every real caller hands the picker its language", () => {
  const CALLERS = [
    "front-end/components/ServiceSelect.tsx",
    "front-end/islands/InvoicesPage.tsx",
    "front-end/islands/PaymentsPage.tsx",
    "front-end/islands/FieldTasksPage.tsx",
    "front-end/islands/FieldSubscriptionsPage.tsx",
  ];

  test.each(CALLERS)("REQ-987 %s passes lang= to every <SearchSelect>", (rel) => {
    const src = read(rel);
    const tags: string[] = [];
    const re = /<SearchSelect\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      // the tag's own props: up to its self-closing "/>" on a line of its own
      const close = src.slice(m.index).search(/\n\s*\/>/);
      expect(close).toBeGreaterThan(0);
      tags.push(src.slice(m.index, m.index + close));
    }
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(/\blang=\{/);
  });
});
