/**
 * REQ-401 — demo-loop cycle 2, issues M30 and m45 (run r561db6d4):
 *  - M30: a batch send that sent nothing still flashed "0 invoices sent — each
 *    client got theirs." next to the failure, and the failure was the backend's
 *    raw English reason ("no recipient: the customer has no email or phone").
 *  - m45: tasks pulled onto an UNSENT draft read "1 completed and invoiced" and
 *    "🔒 invoiced / facturado"; the batch row read "1 drafts · 0 sent · 0 paid".
 * The wording lives in front-end/lib/field-batches.ts (pure, testable here);
 * the islands only render it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  batchCounts,
  describeSend,
  lockLabelKey,
} from "../../front-end/lib/field-batches";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es } as const;
type L = keyof typeof DICTS;
const fill = (s: string, vars: Record<string, string | number> = {}) =>
  s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
const tr = (lang: L) => (key: string, vars?: Record<string, string | number>) =>
  fill(DICTS[lang][key] ?? key, vars);

const invoices = [
  { id: "i-j", customerId: "c-j", customerName: "Johnson" },
  { id: "i-a", customerId: "c-a", customerName: "Ana Torres" },
];
const noRecipient = {
  invoiceId: "i-j",
  reason: "no recipient: the customer has no email or phone",
  code: "noRecipient" as const,
  customerId: "c-j",
};

describe("REQ-401 M30 describeSend — no success sentence when nothing was sent", () => {
  test("sent 0 + one failure: no flash; the failure is translated and names the customer", () => {
    const out = describeSend(
      { sent: 0, failed: [noRecipient] },
      invoices,
      tr("en"),
    );
    expect(out.flash).toBe("");
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].text).toContain("Johnson");
    expect(out.failures[0].text).not.toMatch(/no recipient:/);
    expect(out.failures[0].fix).toBe("Add an email or phone to Johnson");
    expect(out.failures[0].customerId).toBe("c-j");
  });

  test("in Spanish the failure and its fix are Spanish", () => {
    const out = describeSend(
      { sent: 0, failed: [noRecipient] },
      invoices,
      tr("es"),
    );
    expect(out.flash).toBe("");
    expect(out.failures[0].text).toContain("Johnson");
    expect(out.failures[0].text).toMatch(/correo|teléfono/);
    expect(out.failures[0].fix).toMatch(
      /^Agrega un correo o teléfono a Johnson/,
    );
  });

  test("sent 1 + one failure: the flash counts one invoice and the failure stays", () => {
    const out = describeSend(
      { sent: 1, failed: [noRecipient] },
      invoices,
      tr("en"),
    );
    expect(out.flash).toBe("1 invoice sent — each client got theirs.");
    expect(out.failures).toHaveLength(1);
  });

  test("an uncoded failure keeps its reason after the customer's name, with no fix link", () => {
    const out = describeSend(
      { sent: 0, failed: [{ invoiceId: "i-a", reason: "email refused" }] },
      invoices,
      tr("en"),
    );
    expect(out.failures[0]).toEqual({
      text: "Ana Torres: email refused",
      fix: null,
      customerId: "c-a",
    });
  });

  test("the island flashes describeSend's result, never field.lt.sent on its own", () => {
    const island = read("front-end/islands/FieldBatchesPage.tsx");
    expect(island).toContain("describeSend(");
    expect(island).not.toMatch(/tp\("field\.lt\.sent"/);
  });

  test("the backend's no-recipient failure carries the code the page translates", () => {
    const coord = read(
      "backend/src/field/domain/coordinators/field-batches/mod.ts",
    );
    expect(coord).toMatch(/code: "noRecipient"/);
  });
});

describe("REQ-401 m45 a draft is not 'invoiced'", () => {
  test("the pull summary says the tasks are on draft invoices", () => {
    expect(en["field.lt.summary"]).toMatch(
      /^\{pullable\} completed, on draft invoices/,
    );
    expect(es["field.lt.summary"]).toMatch(
      /^\{pullable\} completadas, en facturas borrador/,
    );
    expect(en["field.lt.summary"]).not.toMatch(/completed and invoiced/);
    expect(es["field.lt.summary"]).not.toMatch(/completadas y facturadas/);
  });

  test("the worker's lock reads 'on a draft invoice' until it is sent, 'invoiced' after", () => {
    expect(lockLabelKey("draft")).toBe("worker.onDraft");
    expect(lockLabelKey("invoiced")).toBe("worker.invoiced");
    expect(lockLabelKey(undefined)).toBe("worker.invoiced");
    expect(en["worker.onDraft"]).toBe("on a draft invoice");
    expect(es["worker.onDraft"]).toBe("en factura borrador");
    const screen = read("front-end/islands/WorkerScreen.tsx");
    expect(screen).toMatch(/lockLabelKey\(s\.lockState\)/);
  });

  test("batch counts are plural-aware in both languages", () => {
    const tn = (lang: L) => (key: string, n: number) =>
      fill(DICTS[lang][`${key}.${n === 1 ? "one" : "other"}`] ?? key, { n });
    const one = [{ status: "draft" }];
    expect(batchCounts(one, tn("en"))).toBe("1 draft · 0 sent · 0 paid");
    expect(batchCounts(one, tn("es"))).toBe(
      "1 borrador · 0 enviadas · 0 pagadas",
    );
    const mix = [{ status: "draft" }, { status: "draft" }, { status: "sent" }, {
      status: "paid",
    }];
    expect(batchCounts(mix, tn("en"))).toBe("2 drafts · 1 sent · 1 paid");
    expect(batchCounts(mix, tn("es"))).toBe(
      "2 borradores · 1 enviada · 1 pagada",
    );
    const island = read("front-end/islands/FieldBatchesPage.tsx");
    expect(island).not.toContain('"field.lt.counts"');
    expect(island).toContain("batchCounts(");
  });
});
