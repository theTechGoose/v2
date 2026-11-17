/**
 * REQ-412 — demo-loop cycle 2 (run r561db6d4), demo issues m41 + p12:
 * "Landing hero quote doesn't add up ($4,200+$3,990+$1,950 shown as $10,990)"
 * and "Landing counter reads 'DOCUMENTOS ENVIADOS HASTA HOY 0'".
 *
 * (m41) Every landing mock re-typed its own money and the hero card dropped
 * the $850 demolition line while keeping the $10,990 total. Now ONE sample job
 * (shared/quote-flow/landing-mock-quote.ts) owns the line items and every
 * other figure is computed from them.
 *
 * (p12) #doc-counter-num was SSR'd as a literal "0" and only painted by an
 * IntersectionObserver count-up. Now it is SSR'd with the final grouped number.
 */
import * as fs from "fs";
import * as path from "path";
import {
  formatMockUsd,
  lineTotalCents,
  MOCK_QUOTE,
  MOCK_QUOTE_LINES,
  mockQuoteBoot,
} from "../../shared/quote-flow/landing-mock-quote";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** "$ 4,200" / "$4,200.00" / "− $ 2,500" → cents (signed). */
const cents = (s: string) => {
  const neg = /[−-]/.test(s);
  const n = Math.round(Number(s.replace(/[^0-9.]/g, "")) * 100);
  return neg ? -n : n;
};

describe("REQ-412 m41: one sample job, every figure computed", () => {
  test("the four line items sum to the subtotal ($10,990)", () => {
    expect(MOCK_QUOTE_LINES.map((l) => l.id)).toEqual([
      "demo",
      "cabinets",
      "counters",
      "labor",
    ]);
    expect(sum(MOCK_QUOTE_LINES.map(lineTotalCents))).toBe(
      MOCK_QUOTE.subtotalCents,
    );
    expect(MOCK_QUOTE.subtotalCents).toBe(1_099_000);
    expect(MOCK_QUOTE.estimateCents).toBe(
      MOCK_QUOTE.subtotalCents + MOCK_QUOTE.taxCents,
    );
  });

  test("the three-row compact card folds demolition + labor and sums to the same total", () => {
    const c = MOCK_QUOTE.compact;
    expect(c.demoLaborCents).toBe(
      sum(
        MOCK_QUOTE_LINES.filter((l) => l.id === "demo" || l.id === "labor")
          .map(lineTotalCents),
      ),
    );
    expect(c.cabinetsCents + c.countersCents + c.demoLaborCents).toBe(
      MOCK_QUOTE.subtotalCents,
    );
  });

  test("the contract's payments sum to the contract value; the invoice balance follows", () => {
    const k = MOCK_QUOTE.contract;
    expect(k.depositCents + k.progressCents + k.finalCents).toBe(
      MOCK_QUOTE.subtotalCents,
    );
    const i = MOCK_QUOTE.invoice;
    expect(i.balanceCents).toBe(
      MOCK_QUOTE.subtotalCents + i.changeOrderCents - k.depositCents -
        k.progressCents,
    );
  });

  test("formatMockUsd keeps US grouping in both languages", () => {
    expect(formatMockUsd(1_099_000)).toBe("$10,990");
    expect(formatMockUsd(1_099_000, { decimals: true })).toBe("$10,990.00");
    expect(formatMockUsd(85_000, { spaced: true })).toBe("$ 850");
  });

  test("the boot object the static script reads adds up row by row", () => {
    const b = mockQuoteBoot();
    expect(sum(Object.values(b.lines).map((l) => cents(l.amount)))).toBe(
      cents(b.subtotal),
    );
    expect(cents(b.compact.l1) + cents(b.compact.l2) + cents(b.compact.l3))
      .toBe(cents(b.compact.total));
    expect(cents(b.subtotal) + cents(b.tax)).toBe(cents(b.estimate));
    expect(
      cents(b.contract.deposit) + cents(b.contract.progress) +
        cents(b.contract.final),
    ).toBe(cents(b.contract.total));
    expect(
      cents(b.invoice.completed) + cents(b.invoice.changeOrder) +
        cents(b.invoice.deposit) + cents(b.invoice.progress),
    ).toBe(cents(b.invoice.balance));
  });
});

describe("REQ-412 m41: no landing mock types the sample job's money", () => {
  // Every amount of the sample job, in any of the forms the mocks used.
  const MONEY_RE =
    /\$\s?(10,990|11,870|4,200|3,990|1,950|2,800|2,500|5,495|2,995|3,415|850|880|420)\b/;

  test("routes/index.tsx renders the module's figures, not literals", () => {
    const src = read("front-end/routes/index.tsx");
    expect(src).not.toMatch(MONEY_RE);
    expect(src).toMatch(/landing-mock-quote\.ts/);
    expect(src).toMatch(/__PM_MOCK_QUOTE/);
  });

  test("the hero document card lists all four lines (demolition included), en + es", () => {
    const { LANDING_DICT } = require("../../front-end/lib/landing-dict");
    for (const lang of ["en", "es"] as const) {
      const d = LANDING_DICT[lang] as Record<string, string>;
      expect(typeof d["doc.q.l0"]).toBe("string");
      expect(d["doc.q.l0"].length).toBeGreaterThan(0);
    }
    expect(read("front-end/routes/index.tsx")).toMatch(/doc\.q\.l0/);
  });

  test("static/landing-scripts.js reads __PM_MOCK_QUOTE, types no amount", () => {
    const src = read("front-end/static/landing-scripts.js");
    expect(src).not.toMatch(MONEY_RE);
    expect(src).toMatch(/__PM_MOCK_QUOTE/);
  });

  test("the PhoneChat island's card renders the module's compact figures", () => {
    const src = read("front-end/islands/PhoneChat.tsx");
    expect(src).toMatch(/landing-mock-quote\.ts/);
    expect(src).not.toMatch(/phoneChat\.quote\.amount/);
    for (const f of ["lang/en.json", "lang/es.json"]) {
      expect(read(f)).not.toMatch(/phoneChat\.quote\.amount/);
    }
  });

  test("the contract mock no longer calls $2,500 of $10,990 '25%'", () => {
    const src = read("front-end/static/landing-scripts.js");
    expect(src).not.toMatch(/Deposit \(25%\)|Anticipo \(25%\)/);
  });
});

describe("REQ-412 p12: the documents counter never reads 0", () => {
  test("the counter is server-rendered with formatSocialProof(docsSent, lang)", () => {
    const src = read("front-end/routes/index.tsx");
    expect(src).not.toMatch(/id="doc-counter-num">0</);
    expect(src).toMatch(
      /id="doc-counter-num"[^>]*>\s*\{formatSocialProof\(\s*LANDING_OFFER\.socialProof\.docsSent,\s*lang,?\s*\)\}/,
    );
  });

  test("the script honours prefers-reduced-motion and animates only on entering view", () => {
    const src = read("front-end/static/landing-scripts.js");
    const counter = src.slice(src.indexOf("function counter()"));
    expect(counter).toMatch(/prefers-reduced-motion: reduce/);
    expect(counter).toMatch(/isIntersecting/);
    // `shown` starts at the target, so a language toggle before the scroll
    // re-groups the real number instead of painting 0.
    expect(counter).toMatch(/let shown = target;/);
  });
});
