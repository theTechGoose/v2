/**
 * REQ-996 — LOOP-007 cycle 1, QA issue q1-81: "Batch 'Select all' label doesn't select anything".
 *
 * Since REQ-608 a batch opens with every draft ticked, so the header checkbox is ticked too — but
 * its label still reads "Select all". Clicking that label unticks everything (the toggle's other
 * half), so "Select all" deselects every draft and disables Send. The header must say what a
 * click will do: "Clear all" when every draft is ticked, "Select all" otherwise.
 *
 * Under `deno test` the island compiles with jsx "precompile", which only renders to a string
 * (see pending-reply-bubble.test.tsx), so the click round-trip (Clear all → Select all, lt-check
 * unticked, lt-send disabled → Select all → ticked, enabled) is pinned by the e2e story
 * e2e/batch-select-all-label/batch-select-all-label.e2e.test.ts.
 *
 *   cd front-end && deno test -A lib/field-batches-select-all.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import FieldBatchesPage from "../islands/FieldBatchesPage.tsx";
import type { BatchView } from "../clients/field.ts";
import { langSignal } from "./i18n.ts";

const ROOT = new URL("../../", import.meta.url);
const dict = (lang: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(`lang/${lang}.json`, ROOT)));
/** lang/*.json are FLAT dictionaries: the key is the dotted string itself ("field.lt.selectAll") */
const key = (d: Record<string, unknown>, k: string) => d[k];

const TS = "2026-11-18T10:00:00.000Z";
const batch: BatchView = {
  id: "b-996",
  userId: "u-996",
  from: "2026-11-10",
  to: "2026-11-17",
  invoiceIds: ["i-996"],
  invoices: [{
    id: "i-996",
    customerName: "Ana Torres",
    status: "draft",
    amount: 6500,
    zeroLines: 0,
  }],
  createdAt: TS,
};

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;

/** the batch header's text (the <h3> holding the select-all control and Send) */
function headerText(
  doc: { querySelector(s: string): { textContent: string } | null },
) {
  return doc.querySelector("h3.panel__title")?.textContent ?? "";
}

Deno.test("REQ-996 (LOOP-007 q1-81): both dictionaries carry field.lt.clearAll", () => {
  assertEquals(key(dict("en"), "field.lt.clearAll"), "Clear all");
  assertEquals(key(dict("es"), "field.lt.clearAll"), "Quitar todas");
});

Deno.test("REQ-996 (LOOP-007 q1-81): a batch that opens with its drafts ticked labels the header 'Clear all', not 'Select all'", () => {
  langSignal.value = "en";
  const doc = parse(
    renderToString(<FieldBatchesPage seed={{ batches: [batch] }} />),
  );
  const box = doc.querySelector<HTMLInputElement>(
    "[data-cy='lt-check']",
  );
  assert(box, "the draft's checkbox is rendered");
  assert(box.hasAttribute("checked"), "REQ-608: the draft opens ticked");
  const head = headerText(doc);
  assert(
    head.includes("Clear all"),
    `the header offers "Clear all" while everything is ticked — header was: ${
      JSON.stringify(head)
    }`,
  );
  assert(
    !head.includes("Select all"),
    `the header does not promise "Select all" while everything is already ticked — header was: ${
      JSON.stringify(head)
    }`,
  );
});
