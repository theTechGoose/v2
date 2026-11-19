/**
 * REQ-1055 — LOOP-007 cycle 2, issue q2-39: after a change order is
 * approved, /co and the receipt email give two different "totals" and
 * neither says which total it means.
 *
 * /co's approved intro (`changeOrderIntro`, shared/quote-flow/
 * change-order-view.ts) shows the JOB's new total (REQ-398 m25) but reads
 * "your total is now {total}" / "tu total ahora es {total}"; the receipt
 * shows the linked INVOICE's total. On a deposit + balance job those always
 * differ ($11,200 job vs $8,680 INV-002). The intro must name the total it
 * shows: the job's when /co has the job totals, the invoice's otherwise.
 */
import * as fs from "fs";
import * as path from "path";
import { changeOrderIntro } from "../../shared/quote-flow/change-order-view";

const ROOT = path.resolve(__dirname, "../..");
const dict = (l: "en" | "es"): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `lang/${l}.json`), "utf8"));
const money = (c: number) =>
  `$${
    (c / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
/** Mirrors front-end/lib/i18n.ts tFor interpolation. */
function render(
  l: "en" | "es",
  r: { key: string; vars?: Record<string, string> },
): string {
  const tpl = dict(l)[r.key];
  if (tpl === undefined) throw new Error(`missing ${l} key ${r.key}`);
  return tpl.replace(/\{(\w+)\}/g, (_, k) => r.vars?.[k] ?? `{${k}}`);
}

const DECIDED = "2026-11-18T15:30:00.000Z";
const JOB = {
  status: "approved",
  decidedAt: DECIDED,
  jobNewAmount: 1_120_000,
  newAmount: 868_000,
};
const INVOICE_ONLY = {
  status: "approved",
  decidedAt: DECIDED,
  newAmount: 868_000,
};

describe("REQ-1055 q2-39 the approved /co intro names which total it shows", () => {
  test("REQ-1055 en: with the job totals, the intro says it is the JOB total ($11,200.00)", () => {
    const en = render("en", changeOrderIntro(JOB, "en", money));
    expect(en).toContain("$11,200.00");
    expect(en).toMatch(/job total[^$]*\$11,200\.00/i);
    expect(en).not.toMatch(/\byour total is now\b/i);
  });

  test("REQ-1055 es: with the job totals, the intro says it is the total del trabajo", () => {
    const es = render("es", changeOrderIntro(JOB, "es", money));
    expect(es).toContain("$11,200.00");
    expect(es).toMatch(/total del trabajo[^$]*\$11,200\.00/i);
    expect(es).not.toMatch(/\btu total ahora es\b/i);
  });

  test("REQ-1055 no linked quote: the intro names the INVOICE's total, never 'job'", () => {
    const en = render("en", changeOrderIntro(INVOICE_ONLY, "en", money));
    expect(en).toContain("$8,680.00");
    expect(en).toMatch(/invoice/i);
    expect(en).not.toMatch(/\bjob\b/i);
    const es = render("es", changeOrderIntro(INVOICE_ONLY, "es", money));
    expect(es).toContain("$8,680.00");
    expect(es).toMatch(/factura/i);
    expect(es).not.toMatch(/trabajo/i);
  });

  test("REQ-1055 the job-total and invoice-total intros are different keys/wording", () => {
    const job = changeOrderIntro(JOB, "en", money);
    const inv = changeOrderIntro(INVOICE_ONLY, "en", money);
    expect(render("en", job).replace(/\$[\d,.]+/g, "$")).not.toBe(
      render("en", inv).replace(/\$[\d,.]+/g, "$"),
    );
  });
});
