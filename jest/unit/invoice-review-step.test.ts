/**
 * REQ-627 — "They cannot delay the invoice": the assistant's invoice flows
 * must end at a review step — "Send now" (one tap) / "Save as draft" /
 * "Schedule" — instead of minting the invoice already "sent".
 *
 *   1. The pure decision (front-end/lib/invoice-review-actions.ts): what each
 *      choice writes on the invoice, and when a schedule date is refused.
 *   2. AsstChat.tsx: no invoice is POSTed with a hard-coded `status: "sent"`;
 *      the seeded review creates a DRAFT and the ready card offers the three
 *      choices; the shared invoice preview offers draft + schedule beside Send.
 *   3. Both dictionaries carry every new key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  invoiceStatusFields,
  scheduleDateProblem,
} from "../../front-end/lib/invoice-review-actions";

const ROOT = join(__dirname, "..", "..");
const ASST_CHAT = readFileSync(
  join(ROOT, "front-end", "islands", "AsstChat.tsx"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const TODAY = "2026-11-12";

describe("REQ-627 invoice review actions — what each choice writes", () => {
  it("REQ-627 Send now issues it today", () => {
    expect(invoiceStatusFields("send", { today: TODAY })).toEqual({
      status: "sent",
      issuedDate: TODAY,
    });
  });
  it("REQ-627 Save as draft keeps it a draft — nothing issued", () => {
    expect(invoiceStatusFields("draft", { today: TODAY })).toEqual({
      status: "draft",
    });
  });
  it("REQ-627 Schedule = status scheduled + scheduledFor (InvoicesPage's 'Send on')", () => {
    expect(
      invoiceStatusFields("schedule", { today: TODAY, scheduledFor: "2026-11-20" }),
    ).toEqual({ status: "scheduled", scheduledFor: "2026-11-20" });
  });
  it("REQ-627 Schedule without a valid date throws", () => {
    expect(() => invoiceStatusFields("schedule", { today: TODAY })).toThrow();
    expect(() =>
      invoiceStatusFields("schedule", { today: TODAY, scheduledFor: "2026-11-01" })
    ).toThrow();
  });
  it("REQ-627 scheduleDateProblem: missing, past and today are refused; tomorrow on is fine", () => {
    expect(scheduleDateProblem("", TODAY)).toBe("missing");
    expect(scheduleDateProblem("2026-11-11", TODAY)).toBe("past");
    expect(scheduleDateProblem(TODAY, TODAY)).toBe("today");
    expect(scheduleDateProblem("2026-11-13", TODAY)).toBeNull();
    expect(scheduleDateProblem("not-a-date", TODAY)).toBe("missing");
  });
});

describe("REQ-627 AsstChat ends the invoice flows at a review step", () => {
  it("REQ-627 no invoice is created with a hard-coded status: \"sent\"", () => {
    // every POST /invoices body takes its status from invoiceStatusFields
    const posts = ASST_CHAT.split('api.post<{ id?: string }>("/invoices"');
    expect(posts.length).toBeGreaterThan(1);
    for (const chunk of posts.slice(1)) {
      const body = chunk.slice(0, chunk.indexOf("});"));
      expect(body).not.toMatch(/status:\s*"sent"/);
      expect(body).toMatch(/invoiceStatusFields\(/);
    }
  });
  it("REQ-627 the seeded review saves a DRAFT, and the ready card offers Send now / Save as draft / Schedule", () => {
    const save = ASST_CHAT.slice(
      ASST_CHAT.indexOf("async function saveInvoiceFromReview"),
      ASST_CHAT.indexOf("async function confirmSendInvoiceSwap"),
    );
    expect(save).toMatch(/invoiceStatusFields\("draft"/);
    for (const cy of ["invoice-ready-send", "invoice-ready-draft", "invoice-ready-schedule"]) {
      expect(ASST_CHAT).toContain(`data-cy="${cy}"`);
    }
  });
  it("REQ-627 the shared invoice preview offers Save as draft and Schedule beside Send", () => {
    for (const cy of ["invoice-preview-draft", "invoice-preview-schedule"]) {
      expect(ASST_CHAT).toContain(`data-cy="${cy}"`);
    }
  });
  it("REQ-627 both dictionaries carry every invoiceReview key", () => {
    const keys = [...ASST_CHAT.matchAll(/"(asstChat\.invoiceReview\.[\w.]+)"/g)]
      .map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const k of new Set(keys)) {
      expect(en[k]).toBeTruthy();
      expect(es[k]).toBeTruthy();
    }
  });
});
