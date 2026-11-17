/**
 * REQ-909 — Johanna (A2Z), 2026-11-16, videos 1 and 2: recording a check
 * payment means finding the customer's invoice. The Record-a-payment picker
 * is the SearchSelect (type the customer, the number or the job), the topbar
 * search offers "Record payment" on every unpaid invoice row, and
 * `/payments?record=<id>` opens the modal on that invoice.
 */
import * as fs from "fs";
import * as path from "path";
import { recordIdFromSearch } from "../../front-end/lib/payment-record-option";
import { recordPaymentUrl } from "../../shared/documents/search";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-909 the deep link /payments?record=<id>", () => {
  test("reads the invoice id from the query, with or without the ?", () => {
    expect(recordIdFromSearch("?record=inv-1")).toBe("inv-1");
    expect(recordIdFromSearch("record=inv-1&x=2")).toBe("inv-1");
    expect(recordIdFromSearch("?record=%20inv%201%20")).toBe("inv 1");
  });
  test("is empty when the query carries none", () => {
    expect(recordIdFromSearch("")).toBe("");
    expect(recordIdFromSearch("?open=abc")).toBe("");
    expect(recordIdFromSearch("?record=")).toBe("");
  });
});

describe("REQ-909 the search row's Record payment action", () => {
  const base = { id: "inv-7", related: [] };
  test("an unpaid invoice (sent, revised, claimed) links to /payments?record=<id>", () => {
    for (const status of ["sent", "revised", "claimed"]) {
      expect(recordPaymentUrl({ ...base, type: "invoice", status })).toBe(
        "/payments?record=inv-7",
      );
    }
  });
  test("the id is URL-encoded", () => {
    expect(recordPaymentUrl({ type: "invoice", id: "a b/c", status: "sent" }))
      .toBe("/payments?record=a%20b%2Fc");
  });
  test("nothing for a paid, void or draft invoice, nor any other type", () => {
    for (const status of ["paid", "void", "draft"]) {
      expect(recordPaymentUrl({ ...base, type: "invoice", status }))
        .toBeUndefined();
    }
    expect(recordPaymentUrl({ ...base, type: "customer", status: "sent" }))
      .toBeUndefined();
    expect(recordPaymentUrl({ ...base, type: "quote", status: "sent" }))
      .toBeUndefined();
  });
  test("GlobalSearch renders it as [data-cy=global-search-record] with the key", () => {
    const src = read("front-end/islands/GlobalSearch.tsx");
    expect(src).toMatch(/recordPaymentUrl\(h\)/);
    expect(src).toMatch(
      /data-cy="global-search-record"[\s\S]{0,200}search\.recordPayment/,
    );
  });
});

describe("REQ-909 the Record-a-payment picker is the search-and-pick", () => {
  test("PaymentsPage mounts SearchSelect under the picker hook; no native select remains", () => {
    const src = read("front-end/islands/PaymentsPage.tsx");
    expect(src).toMatch(/import SearchSelect from "\.\/SearchSelect\.tsx"/);
    expect(src).toMatch(
      /data-cy="payments-record-invoice"[\s\S]{0,300}<SearchSelect/,
    );
    expect(src).not.toMatch(/<select\s+data-cy="payments-record-invoice"/);
    // clearing the box un-picks the invoice
    expect(src).toMatch(/onQuery=\{[\s\S]{0,200}setRecordId\(""\)/);
    // the deep link: read after hydration, applied once the invoice is an option
    expect(src).toMatch(/recordIdFromSearch\(globalThis\.location\?\.search/);
    expect(src).toMatch(/initialRecordId=\{wantRecord\}/);
    expect(src).toMatch(
      /recordOptions\.some\(\(o\) => o\.id === initialRecordId\)/,
    );
  });
  test("the payments route links the search-select stylesheet", () => {
    const src = read("front-end/routes/payments/index.tsx");
    expect(src).toMatch(/href=\{asset\("\/search-select\.css"\)\}/);
  });
  test("both languages carry the placeholder and the row action", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      expect(typeof dict["paymentsPage.record.search"]).toBe("string");
      expect(typeof dict["search.recordPayment"]).toBe("string");
    }
  });
});
