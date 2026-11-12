/**
 * REQ-706 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue p18-9a (RCA CONFIRMED,
 * skeptic UPHELD at 2444608a):
 *
 * 1. The invoices "Out for payment" empty track said "Send a quote to get
 *    paid" — inside the invoices section, which has its own New invoice.
 * 2. An invoice with no job name showed the client twice in the detail
 *    header: "Linda Morales" / "Linda Morales · INV-001".
 * 3. The quote document printed "Published <date>" right under a headline
 *    that already reads "Q-001 · Version 1 · Sent · <same date>".
 */
import * as fs from "fs";
import * as path from "path";
import { detailTitle } from "../../front-end/lib/invoice-card";
import { publishedLineDate } from "../../shared/quote-flow/public-doc-state";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-706 (cycle 5, p18-9a) the invoices empty track talks about invoices", () => {
  test("en and es point at invoices you send, never at quotes", () => {
    expect(en["invoicesPage.empty.out"]).toBe(
      "Nothing out. Invoices you send land here.",
    );
    expect(es["invoicesPage.empty.out"]).toBe(
      "Nada en espera. Cuando envíes una factura, aparece aquí.",
    );
    expect(en["invoicesPage.empty.out"]).not.toMatch(/quote/i);
    expect(es["invoicesPage.empty.out"]).not.toMatch(/cotizaci/i);
  });
});

describe("REQ-706 (cycle 5, p18-9a) the invoice detail header names the client once", () => {
  test("no job name: the client is the title and the sub-line is just the ref", () => {
    const h = detailTitle({ client: "Linda Morales", invoiceRef: "INV-001" });
    expect(h).toEqual({ title: "Linda Morales", sub: "INV-001" });
    expect(`${h.title} ${h.sub}`.split("Linda Morales").length - 1).toBe(1);
  });
  test("a blank job name counts as missing", () => {
    expect(
      detailTitle({
        jobName: "  ",
        client: "Linda Morales",
        invoiceRef: "INV-001",
      }),
    ).toEqual({ title: "Linda Morales", sub: "INV-001" });
  });
  test("with a job name: job is the title, client · ref the sub-line", () => {
    expect(
      detailTitle({
        jobName: "Kitchen remodel",
        client: "Linda Morales",
        invoiceRef: "INV-001",
      }),
    ).toEqual({ title: "Kitchen remodel", sub: "Linda Morales · INV-001" });
  });
  test("InvoicesPage renders the header through detailTitle", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/detailTitle\(/);
    expect(src).not.toMatch(/\{jobName \?\? inv\.client\}/);
  });
});

describe("REQ-706 (cycle 5, p18-9a) 'Published' is not repeated under the headline", () => {
  test("version 1: the headline already carries the sent date — no Published line", () => {
    const at = "2026-11-12T15:04:00.000Z";
    expect(publishedLineDate(at, at)).toBeUndefined();
    // same calendar day, different time: still the same date on screen
    expect(publishedLineDate(at, "2026-11-12T09:00:00.000Z")).toBeUndefined();
  });
  test("the headline shows no date (the sample): Published still shows", () => {
    expect(publishedLineDate("2026-11-12T15:04:00.000Z", undefined)).toBe(
      "2026-11-12T15:04:00.000Z",
    );
  });
  test("a different date in the headline: Published shows", () => {
    expect(
      publishedLineDate("2026-11-10T15:04:00.000Z", "2026-11-12T15:04:00.000Z"),
    ).toBe("2026-11-10T15:04:00.000Z");
  });
  test("nothing published: nothing to show", () => {
    expect(publishedLineDate(undefined, "2026-11-12")).toBeUndefined();
  });
  test("quote-doc gates the Published line through publishedLineDate", () => {
    const src = read("front-end/components/quote-doc.tsx");
    expect(src).toMatch(/publishedLineDate\(/);
    expect(src).not.toMatch(/\{!signed && quote\.publishedAt\s*\n?\s*\?/);
  });
});
