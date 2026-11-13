/**
 * REQ-627 — removing an invoice with a clear process (Delete / Void / locked),
 * bulk Delete/Void over a multi-select, and "Void & duplicate".
 * REQ-629 — batch print: the same selection → ONE PDF (POST /api/invoices/pdf-batch),
 * "Select all in view", and a Download PDF in the invoice panel.
 */
import * as fs from "fs";
import * as path from "path";
import {
  bulkPlan,
  downloadInvoicesPdf,
  summarizeBulk,
} from "../../front-end/lib/invoice-bulk";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-627 bulkPlan — the per-invoice rules applied to a selection", () => {
  const invs = [
    { id: "d", status: "draft" },
    { id: "s", status: "sent" },
    { id: "p", status: "paid" },
    { id: "v", status: "void" },
    { id: "dp", status: "draft", paidCents: 100 },
  ];
  test("delete takes the never-sent drafts and skips the rest with the reason", () => {
    expect(bulkPlan(invs, "delete")).toEqual({
      apply: ["d"],
      skip: [
        { id: "s", reason: "must_void" },
        { id: "p", reason: "locked_paid" },
        { id: "v", reason: "already_void" },
        { id: "dp", reason: "must_void" },
      ],
    });
  });
  test("void takes the sent / paid-into ones and skips drafts (delete those) and paid", () => {
    expect(bulkPlan(invs, "void")).toEqual({
      apply: ["s", "dp"],
      skip: [
        { id: "d", reason: "must_delete" },
        { id: "p", reason: "locked_paid" },
        { id: "v", reason: "already_void" },
      ],
    });
  });
  test("summarizeBulk counts what the server did and why it skipped", () => {
    expect(summarizeBulk([
      { id: "a", outcome: "deleted" },
      { id: "b", outcome: "skipped", reason: "must_void" },
      { id: "c", outcome: "skipped", reason: "must_void" },
      { id: "d", outcome: "skipped", reason: "locked_paid" },
    ])).toEqual({ done: 1, skipped: { must_void: 2, locked_paid: 1 } });
  });
});

describe("REQ-629 downloadInvoicesPdf — one POST, one file", () => {
  test("posts the ids to /api/invoices/pdf-batch and saves the PDF it gets back", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const saved: string[] = [];
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition":
            'attachment; filename="invoices-2026-11-12.pdf"',
        },
      });
    };
    const r = await downloadInvoicesPdf(["a", "b"], {
      fetch: fakeFetch as unknown as typeof fetch,
      save: (_blob: Blob, name: string) => saved.push(name),
    });
    expect(r).toEqual({ ok: true });
    expect(calls[0][0]).toBe("/api/invoices/pdf-batch");
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ ids: ["a", "b"] });
    expect(saved).toEqual(["invoices-2026-11-12.pdf"]);
  });
  test("a refusal is reported, never thrown; more than 500 is refused before the call", async () => {
    const r = await downloadInvoicesPdf(["a"], {
      fetch: (async () =>
        new Response("{}", { status: 404 })) as unknown as typeof fetch,
      save: () => {},
    });
    expect(r).toEqual({ ok: false, status: 404 });
    const many = await downloadInvoicesPdf(
      Array.from({ length: 501 }, (_, i) => `x${i}`),
      {
        fetch: (() => {
          throw new Error("must not call");
        }) as unknown as typeof fetch,
        save: () => {},
      },
    );
    expect(many).toEqual({ ok: false, status: 400 });
  });
});

describe("REQ-627/629 the invoices page wiring", () => {
  const src = read("front-end/islands/InvoicesPage.tsx");
  test("void, void & duplicate, the Cancelled track, the paid-is-locked note", () => {
    for (
      const cy of [
        "invoice-void",
        "invoice-void-confirm",
        "invoice-void-duplicate",
        "invoice-void-reason",
        "invoice-voided-note",
        "invoices-cancelled-track",
        "invoice-card-void",
        "invoice-void-payments-note",
      ]
    ) {
      expect(src).toContain(`data-cy="${cy}"`);
    }
    expect(src).toMatch(/\/api\/invoices\/\$\{inv\.id\}\/void`/);
    expect(src).toMatch(/\/api\/invoices\/\$\{inv\.id\}\/void-duplicate`/);
  });
  test("multi-select: the select toggle, a checkbox per card, the bulk bar with print (primary), delete, void, select all in view", () => {
    for (
      const cy of [
        "invoices-select-toggle",
        "invoice-select",
        "invoices-bulk-bar",
        "invoices-bulk-print",
        "invoices-bulk-delete",
        "invoices-bulk-void",
        "invoices-bulk-select-all",
        "invoices-bulk-result",
        "invoice-download-pdf",
      ]
    ) {
      expect(src).toContain(`data-cy="${cy}"`);
    }
    expect(src).toMatch(/"\/api\/invoices\/bulk-remove"/);
    expect(src).toMatch(/downloadInvoicesPdf\(/);
  });
  test("every new string exists in both languages", () => {
    const keys = [
      ...src.matchAll(
        /tFor\(\s*lang,\s*"(invoicesPage\.(?:remove|bulk|cta\.void|subline\.void|track\.cancelled|empty\.cancelled|detail\.downloadPdf)[^"]*)"/g,
      ),
    ].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of new Set(keys)) {
      expect([k, en[k]]).toEqual([k, expect.any(String)]);
      expect([k, es[k]]).toEqual([k, expect.any(String)]);
    }
  });
});

describe("REQ-627 the customer's link of a voided invoice", () => {
  const page = read("front-end/routes/i/[id].tsx");
  test("says it is cancelled, shows nothing due, and offers no way to pay", () => {
    expect(page).toMatch(/const voided = invoice\.status === "void"/);
    expect(page).toContain('data-cy="invoice-cancelled-note"');
    // the pay UI is the last branch, after the voided one
    expect(page.indexOf('data-cy="invoice-cancelled-note"')).toBeLessThan(page.indexOf("<PublicInvoiceClaim"));
    for (const k of ["pill", "label", "note", "paymentsNote"]) {
      expect(en[`publicInvoice.cancelled.${k}`]).toBeTruthy();
      expect(es[`publicInvoice.cancelled.${k}`]).toBeTruthy();
    }
  });
});
