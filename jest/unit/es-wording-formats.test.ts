/**
 * REQ-276 — demo issue i18n-formatting-m8: "Spanish wording and formats:
 * calques, English words, English formats, usted/tú mix, 'cuatro cien
 * cincuenta', mixed-language send result".
 *
 * The pure formatters live in shared/quote-flow/locale-format.ts (new):
 *   numberInWords(n, lang)        — real Spanish grammar, not English word order
 *   amountInWords(cents, lang)    — the MoneyInput "in words" line
 *   formatClockTime(date, lang)   — the chat bubble time, in the APP language
 *   formatGreetingDate(date, lang) — the topbar date line, in the language's order
 * and the job-name casing helper in shared/quote-flow/job-name.ts:
 *   jobNameCase(name, lang)       — es job names are sentence case
 */
import * as fs from "fs";
import * as path from "path";

// Lazy accessors so a missing module reds only the tests that use it.
// deno-lint-ignore no-explicit-any
const lf = (): any => require("../../shared/quote-flow/locale-format");
// deno-lint-ignore no-explicit-any
const jn = (): any => require("../../shared/quote-flow/job-name");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-276 Spanish numbers in words (MoneyInput)", () => {
  it.each([
    [1, "uno"],
    [16, "dieciséis"],
    [21, "veintiuno"],
    [22, "veintidós"],
    [31, "treinta y uno"],
    [100, "cien"],
    [101, "ciento uno"],
    [450, "cuatrocientos cincuenta"],
    [500, "quinientos"],
    [777, "setecientos setenta y siete"],
    [999, "novecientos noventa y nueve"],
    [1000, "mil"],
    [1001, "mil uno"],
    [2500, "dos mil quinientos"],
    [21000, "veintiún mil"],
    [100000, "cien mil"],
    [1_000_000, "un millón"],
    [2_000_000, "dos millones"],
  ])("REQ-276 es %d → %s", (n, words) => {
    expect(lf().numberInWords(n, "es")).toBe(words);
  });

  it.each([
    [21, "twenty-one"],
    [450, "four hundred fifty"],
    [1000, "one thousand"],
    [2_000_000, "two million"],
  ])("REQ-276 en %d → %s (unchanged)", (n, words) => {
    expect(lf().numberInWords(n, "en")).toBe(words);
  });

  it.each([
    [45000, "es", "cuatrocientos cincuenta dólares"],
    [100, "es", "un dólar"],
    [2100, "es", "veintiún dólares"],
    [45025, "es", "cuatrocientos cincuenta dólares con veinticinco centavos"],
    [101, "es", "un dólar con un centavo"],
    [100_000_000, "es", "un millón de dólares"],
    [0, "es", "cero dólares"],
    [45025, "en", "four hundred fifty dollars and twenty-five cents"],
    [100, "en", "one dollar"],
  ])("REQ-276 amount %d cents (%s) → %s", (cents, lang, words) => {
    expect(lf().amountInWords(cents, lang)).toBe(words);
  });

  it("REQ-276 MoneyInput reads its words from the shared formatter, not an English-grammar numToWords", () => {
    const src = read("front-end/islands/MoneyInput.tsx");
    expect(src).toMatch(/amountInWords/);
    expect(src).not.toMatch(/function numToWords/);
  });
});

describe("REQ-276 chat times follow the app language, not the browser", () => {
  const evening = new Date(2026, 10, 11, 20, 55);
  const morning = new Date(2026, 10, 11, 9, 5);
  it("REQ-276 es reads 'p. m.' / 'a. m.', never the English PM", () => {
    expect(lf().formatClockTime(evening, "es")).toBe("8:55 p. m.");
    expect(lf().formatClockTime(morning, "es")).toBe("9:05 a. m.");
  });
  it("REQ-276 en reads 8:55 PM", () => {
    expect(lf().formatClockTime(evening, "en")).toBe("8:55 PM");
    expect(lf().formatClockTime(new Date(2026, 0, 1, 0, 0), "en")).toBe(
      "12:00 AM",
    );
  });
  it("REQ-276 no chat bubble formats time with the browser locale ([])", () => {
    for (
      const f of [
        "front-end/components/MessageBubble.tsx",
        "front-end/islands/AsstChat.tsx",
      ]
    ) {
      const src = read(f);
      expect({ f, hit: /toLocaleTimeString\(\s*\[\]/.test(src) }).toEqual({
        f,
        hit: false,
      });
      expect(src).toMatch(/formatClockTime/);
    }
  });
});

describe("REQ-276 the topbar date line is in the language's own order", () => {
  const wed = new Date(2026, 10, 11, 12, 0);
  it("REQ-276 es: 'Miércoles · 11 de noviembre', not 'Miércoles · noviembre 11'", () => {
    expect(lf().formatGreetingDate(wed, "es")).toBe(
      "Miércoles · 11 de noviembre",
    );
  });
  it("REQ-276 en keeps 'Wednesday · November 11'", () => {
    expect(lf().formatGreetingDate(wed, "en")).toBe("Wednesday · November 11");
  });
  it("REQ-276 DashTopbar builds its date line with formatGreetingDate", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/formatGreetingDate\(/);
    expect(src).not.toMatch(/MONTH_KEYS\[now\.getMonth\(\)\]/);
  });
});

describe("REQ-276 Spanish copy: no calques, no English words, tú throughout", () => {
  it("REQ-276 no literal 'mantienen las luces encendidas' calque", () => {
    for (
      const k of [
        "clientsHero.emptyTitlePost",
        "clientsHero.titlePost",
        "clientsHero.titlePost.one",
      ]
    ) {
      expect({ k, v: es[k] }).not.toEqual({
        k,
        v: expect.stringMatching(/luces encendidas/i),
      });
    }
  });
  it("REQ-276 no 'Bloqueamos la cotización'", () => {
    expect(es["lockQuote.cta.lockedPrompt"]).not.toMatch(/Bloqueamos/);
  });
  it("REQ-276 no English 'pipeline' in Spanish strings", () => {
    const hits = Object.entries(es).filter(([, v]) => /pipeline/i.test(v));
    expect(hits).toEqual([]);
  });
  it("REQ-276 the assistant is not the 'PM' (old brand) assistant in either language", () => {
    for (
      const k of ["assistantPage.assistantHelp", "asstChat.header.default"]
    ) {
      expect({ k, v: es[k] }).not.toEqual({
        k,
        v: expect.stringMatching(/\bPM\b/),
      });
      expect({ k, v: en[k] }).not.toEqual({
        k,
        v: expect.stringMatching(/\bPM\b/),
      });
    }
  });
  it("REQ-276 the quote document speaks tú: 'tu proyecto', not 'su proyecto'", () => {
    expect(es["quoteDoc.qSigned"]).toBe("¿Preguntas sobre tu proyecto?");
  });
});

describe("REQ-276 the send result note is one language: the contractor's", () => {
  it("REQ-276 send-quote renders its divider in the contractor's UI language, not the document language", () => {
    const src = read(
      "backend/src/agents/domain/coordinators/send-quote/mod.ts",
    );
    expect(src).not.toMatch(/lang:\s*input\.language\s*\?\?\s*"en"/);
  });
});

describe("REQ-276 Spanish job names are sentence case, whatever wrote them", () => {
  it("REQ-276 jobNameCase('Corte De Césped', 'es') → 'Corte de césped'", () => {
    expect(jn().jobNameCase("Corte De Césped", "es")).toBe("Corte de césped");
    expect(jn().jobNameCase("  instalación de Patio ", "es")).toBe(
      "Instalación de patio",
    );
  });
  it("REQ-276 en job names keep their Title Case", () => {
    expect(jn().jobNameCase("Lawn Mowing", "en")).toBe("Lawn Mowing");
  });
  it("REQ-276 the assistant runs every per-language job name through jobNameCase before storing", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/jobNameCase\(/);
  });
});
