/**
 * REQ-025 — 4.3 NW-13 cleanup: the standalone "Job done, need to invoice"
 * customer step is gone.
 *
 * After REQ-023 (accepted job → seeded review) and REQ-024 (brand-new invoice
 * → the shared wizard + preview), the pre-wizard standalone path — its own
 * CustomerStepPanel mount (`invoiceCustomerOpen`), `openInvoiceCustomerStep`
 * and `createInvoiceFromFlow` — has no caller left. Dead code in a 7,000-line
 * island is a trap for the next reader (and the back-stack still snapshots
 * `invoiceCustomerOpen`), so this file pins its removal:
 *
 *   1. AsstChat.tsx no longer mentions the three dead symbols.
 *   2. Every remaining `asstChat.invoiceFlow.*` key in BOTH dictionaries is
 *      referenced from front-end/ or shared/ — no orphaned copy
 *      (`needCustomer` was only ever read by createInvoiceFromFlow).
 *
 * Kept on purpose (referenced by the REQ-023 seeded review): `invoiceReview`,
 * `saveInvoiceFromReview`, `invoiceResult` and the success card, and
 * `resolveAssistantBack.invoiceResultOpen`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const ASST_CHAT = readFileSync(
  join(ROOT, "front-end", "islands", "AsstChat.tsx"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

/** Every .ts/.tsx source under front-end/ (minus the ui-breakdown mock copy
 *  and build output) and shared/, concatenated. */
function sourceCorpus(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (
        name === "node_modules" || name === "_fresh" || name === "ui-breakdown" ||
        name === "dist" || name.startsWith(".")
      ) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join(ROOT, "front-end"));
  walk(join(ROOT, "shared"));
  return out.join("\n");
}

describe("REQ-025 NW-13 cleanup: the standalone invoice customer step is deleted", () => {
  it.each([
    "invoiceCustomerOpen",
    "openInvoiceCustomerStep",
    "createInvoiceFromFlow",
  ])("REQ-025 AsstChat.tsx no longer mentions %s", (symbol) => {
    expect(ASST_CHAT.includes(symbol)).toBe(false);
  });

  it("REQ-025 asstChat.invoiceFlow.needCustomer is gone from both dictionaries", () => {
    // Flat dot-keys: index directly (toHaveProperty would walk the dots).
    expect(en["asstChat.invoiceFlow.needCustomer"]).toBeUndefined();
    expect(es["asstChat.invoiceFlow.needCustomer"]).toBeUndefined();
  });

  it("REQ-025 every remaining asstChat.invoiceFlow.* key is referenced from front-end/ or shared/", () => {
    const corpus = sourceCorpus();
    const keys = Object.keys(en).filter((k) =>
      k.startsWith("asstChat.invoiceFlow.")
    );
    expect(keys.length).toBeGreaterThan(0);
    const orphaned = keys.filter((k) => !corpus.includes(`"${k}"`));
    expect(orphaned).toEqual([]);
  });
});
