/**
 * REQ-906 — Johanna (A2Z), 2026-11-16: "También nos gustaría que el nombre
 * del cliente se vea más grande." The customer's name is the biggest thing
 * on an invoice: the detail title (REQ-706 amended), a bold card line, the
 * Bill-to name on the customer page and on the PDF.
 */
import * as fs from "fs";
import * as path from "path";
import { detailTitle } from "../../front-end/lib/invoice-card";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-906 the invoice detail title is always the customer", () => {
  test("with a job name: the customer is the title, 'job · ref' the sub-line", () => {
    expect(
      detailTitle({
        jobName: "Maintenance 2026-10-01 → 2026-10-31",
        client: "Robert Frakes",
        invoiceRef: "INV-003",
      }),
    ).toEqual({
      title: "Robert Frakes",
      sub: "Maintenance 2026-10-01 → 2026-10-31 · INV-003",
    });
  });
  test("without a job name: the customer is the title, the ref the sub-line", () => {
    expect(detailTitle({ client: "Robert Frakes", invoiceRef: "INV-003" }))
      .toEqual({ title: "Robert Frakes", sub: "INV-003" });
  });
  test("the client is still named once (REQ-706 stands on that)", () => {
    const h = detailTitle({
      jobName: "Mulch",
      client: "Robert Frakes",
      invoiceRef: "INV-003",
    });
    expect(`${h.title} ${h.sub}`.split("Robert Frakes").length - 1).toBe(1);
  });
});

describe("REQ-906 the card's client line is bold ink, not a muted caption", () => {
  test(".qcard__client-name is at least 14px, weight 700, --fg", () => {
    const css = read("front-end/static/quotes.css");
    const m = css.match(/\.qcard__client-name\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    const rule = m![1];
    const size = Number((rule.match(/font-size:\s*([\d.]+)px/) ?? [])[1]);
    expect(size).toBeGreaterThanOrEqual(14);
    expect(rule).toMatch(/font-weight:\s*700/);
    expect(rule).toMatch(/color:\s*var\(--fg\)/);
    expect(rule).not.toMatch(/var\(--fg-muted\)/);
    // the line still clips long names instead of wrapping the card
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
  });
});

describe("REQ-906 the customer page's Bill-to name is 18px; the From card stays as it was", () => {
  test("PartyCard takes nameSize (default 15) and marks the name", () => {
    const src = read("front-end/components/doc-parts.tsx");
    expect(src).toMatch(/nameSize\?:\s*number/);
    expect(src).toMatch(/props\.nameSize\s*\?\?\s*15/);
    expect(src).toMatch(/data-cy="party-name"/);
  });
  test("/i/[id].tsx passes nameSize={18} to the Bill-to card only", () => {
    const src = read("front-end/routes/i/[id].tsx");
    const cards = src.match(/<PartyCard[\s\S]*?\/>/g) ?? [];
    const billTo = cards.find((c) => c.includes("publicInvoice.billTo"));
    const from = cards.find((c) => c.includes("quoteDoc.from"));
    expect(billTo).toBeDefined();
    expect(from).toBeDefined();
    expect(billTo).toMatch(/nameSize=\{18\}/);
    expect(from).not.toMatch(/nameSize/);
  });
});

describe("REQ-906 the PDF draws the first Bill-to line at 11pt bold", () => {
  test("render-invoice-pdf sizes the customer's first line 11, the From block 9", () => {
    const src = read(
      "backend/src/paperwork/domain/coordinators/render-invoice-pdf/mod.ts",
    );
    // the TO/FROM block: the to-line's size is 11 for the first row
    const block = src.slice(
      src.indexOf("TO / FROM block"),
      src.indexOf("Amount due card"),
    );
    expect(block).toMatch(/toLines\[i\][\s\S]{0,200}size:\s*i === 0 \? 11 : 9/);
    expect(block).toMatch(/fromLines\[i\][\s\S]{0,200}size:\s*9,/);
  });
});
