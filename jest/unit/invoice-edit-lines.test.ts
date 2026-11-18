/**
 * REQ-910 — Johanna (A2Z), 2026-11-16, video 3 + the invoice photos: "Este
 * invoice le faltó agregar el 10% y no tenemos la opción de editarlo." A sent
 * invoice's edit form can add and remove lines, price a percentage of the
 * lines above as a plain Overhead line (flagged like the batch's REQ-788
 * line), and after Save says the customer still sees the published version
 * until the revision is published.
 */
import * as fs from "fs";
import * as path from "path";
import { percentOfLinesCents } from "../../shared/documents/invoice-form";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-910 percentOfLinesCents", () => {
  const lines = [2, 9, 16, 23, 30].map((d) => ({
    description: `Oct ${d} — Lawn`,
    quantity: 1,
    price: 7000,
  }));
  test("10% of five $70 lines is $35.00", () => {
    expect(percentOfLinesCents(lines, 10)).toBe(3500);
  });
  test("quantities count; the result is rounded to a cent", () => {
    expect(percentOfLinesCents([{ description: "x", quantity: 3, price: 333 }], 10))
      .toBe(100); // 999 × 10% = 99.9 → 100
    expect(percentOfLinesCents([{ description: "x", quantity: 1, price: 1005 }], 2.5))
      .toBe(25); // 25.125 → 25
  });
  test("no lines, a zero, a negative or a non-number percent → 0", () => {
    expect(percentOfLinesCents([], 10)).toBe(0);
    expect(percentOfLinesCents(lines, 0)).toBe(0);
    expect(percentOfLinesCents(lines, -5)).toBe(0);
    expect(percentOfLinesCents(lines, Number.NaN)).toBe(0);
  });
});

describe("REQ-910 the sent-invoice edit form", () => {
  const src = read("front-end/islands/InvoicesPage.tsx");
  const form = src.slice(
    src.indexOf('data-cy="invoice-edit-form"'),
    src.indexOf('data-cy="invoice-edit-save"'),
  );
  test("the lines block always renders — a one-amount invoice can gain its first line", () => {
    expect(form).toMatch(/data-cy="invoice-edit-lines"/);
    expect(form).not.toMatch(/editItems\.length > 0 &&/);
  });
  test("every line has a remove button, and there is an add button", () => {
    expect(form).toMatch(/data-cy=\{`invoice-edit-line-remove-\$\{i\}`\}/);
    expect(form).toMatch(/editItems\.filter\(\(_, j\) => j !== i\)/);
    expect(form).toMatch(/data-cy="invoice-edit-line-add"/);
    // REQ-921 AMENDS: the add button reads "Add a service" (a service line)
    expect(form).toMatch(/serviceLines\.add/);
  });
  test("a percent of the lines above becomes an Overhead line, priced now", () => {
    expect(form).toMatch(/data-cy="invoice-edit-pct"/);
    expect(form).toMatch(/data-cy="invoice-edit-pct-add"/);
    expect(src).toMatch(/percentOfLinesCents\(/);
    expect(src).toMatch(
      /description: tFor\(lang, "invoicesPage\.detail\.overheadLine"\)[\s\S]{0,120}overhead: true/,
    );
  });
  test("each line carries the overhead flag in, through the form and out", () => {
    expect(src).toMatch(/interface EditableLine \{[\s\S]{0,400}overhead\?: boolean/);
    expect(src).toMatch(/row\.overhead === true \? \{ overhead: true \}/);
    expect(form).toMatch(/data-cy=\{`invoice-edit-line-overhead-\$\{i\}`\}/);
    expect(src).toMatch(/\.\.\.\(li\.overhead \? \{ overhead: true \} : \{\}\)/);
  });
  test("after Save on an issued invoice the publish note names the customer", () => {
    expect(src).toMatch(
      /if \(isInvoiceIssued\(inv\)\) \{\s*setPublishNote\([\s\S]{0,120}invoices\.savedUnpublished/,
    );
  });
  test("both languages carry the new copy", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      for (
        const k of [
          "invoicesPage.detail.overheadFlag",
          "invoicesPage.detail.overheadLine",
          "invoicesPage.detail.pctOfLines",
          "invoicesPage.detail.pctAdd",
          "invoices.savedUnpublished",
        ]
      ) expect(typeof dict[k]).toBe("string");
      expect(dict["invoices.savedUnpublished"]).toMatch(/\{customer\}/);
    }
  });
});
