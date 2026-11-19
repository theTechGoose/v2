/**
 * REQ-1099 — LOOP-007 cycle 3, issue q3-24. Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * A pending change order hung on a scheduled, never-sent balance invoice
 * (deposit + balance job) opened /co with "Your contractor proposed an
 * adjustment to your invoice" — an invoice the customer never received.
 * `changeOrderIntro` takes an `onJob` input (the order's invoice has not
 * reached the customer) and then speaks of the job, never "invoice".
 */
import * as fs from "fs";
import * as path from "path";
import { changeOrderIntro } from "../../shared/quote-flow/change-order-view";

const ROOT = path.resolve(__dirname, "../..");
const dict = (l: "en" | "es"): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `lang/${l}.json`), "utf8"));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

describe("REQ-1099 q3-24 the pending /co intro on an unsent invoice names the job", () => {
  test("REQ-1099 pending + onJob → an intro with no 'invoice' / 'factura' (en + es)", () => {
    // deno-lint-ignore no-explicit-any
    const intro = changeOrderIntro as any;
    for (
      const [lang, word] of [["en", /invoice/i], ["es", /factura/i]] as const
    ) {
      const r = intro({ status: "pending", onJob: true }, lang, money);
      const text = dict(lang)[r.key];
      expect(text).toBeDefined();
      expect(text).not.toMatch(word);
    }
  });

  test("REQ-1099 pending on an issued invoice keeps the invoice wording (REQ-689 kept)", () => {
    const r = changeOrderIntro({ status: "pending" }, "en", money);
    expect(r.key).toBe("changeOrderPublic.intro");
  });
});
