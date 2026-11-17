/**
 * REQ-777 — demo-loop cycle dv1, M9 (verify round 6): "'Job done, invoice
 * them' keeps the customer even when it was set through the quote's setup
 * questions".
 *
 * Draft Q-001 "Bathroom Tile Installation" got Ana Diaz in its wizard's
 * customer step. "Job done, need to invoice her" in its thread now names her
 * (the server reads the bound customer, AnswerBilling), and the flow carries
 * her name (`prefillCustomerName`). But the invoice wizard's "Who is this
 * for?" only put that name in the hidden create form's input: the step's
 * known-customer match and its prefill both read `stepFacts`, which had no
 * name — so it showed the bare pick list with Ana Diaz not chosen.
 *
 * Target: shared/quote-flow/customer-dedupe.ts `withOfferedCustomerName` +
 * the AsstChat customer step's facts.
 */
import { readFileSync } from "fs";
import { join } from "path";

// deno-lint-ignore no-explicit-any
let dedupe: any;
beforeAll(() => {
  dedupe = require("../../shared/quote-flow/customer-dedupe");
});

describe("REQ-777 M9 withOfferedCustomerName — the flow's customer reaches the step's facts", () => {
  test("no name in the facts → the offered name fills it", () => {
    expect(
      dedupe.withOfferedCustomerName({ customerEmail: "x@y.z" }, " Ana Diaz "),
    ).toEqual({ customerEmail: "x@y.z", customerName: "Ana Diaz" });
  });
  test("a name already in the facts wins; no offer leaves them as they are", () => {
    const named = { customerName: "Maria Lopez" };
    expect(dedupe.withOfferedCustomerName(named, "Ana Diaz")).toBe(named);
    const empty = {};
    expect(dedupe.withOfferedCustomerName(empty, null)).toBe(empty);
    expect(dedupe.withOfferedCustomerName(empty, "  ")).toBe(empty);
  });
  test("with the offered name, the step offers the saved Ana Diaz in one tap", () => {
    const customers = [
      { id: "c-1", name: "Ana Díaz", email: "ana.diaz@example.com" },
      { id: "c-2", name: "Bob Smith" },
    ];
    const facts = dedupe.withOfferedCustomerName({}, "Ana Diaz");
    const known = dedupe.knownCustomerForStep(null, customers, facts);
    expect(known?.source).toBe("match");
    expect(known?.customer.id).toBe("c-1");
    // without it (the bug): nobody is offered
    expect(dedupe.knownCustomerForStep(null, customers, {})).toBeNull();
  });
});

describe("REQ-777 M9 AsstChat's customer step reads the flow's customer", () => {
  const src = readFileSync(
    join(__dirname, "../../front-end/islands/AsstChat.tsx"),
    "utf8",
  );
  test("stepFacts carries prefillCustomerName via withOfferedCustomerName", () => {
    expect(src).toMatch(
      /withOfferedCustomerName\(\s*withSummaryCustomerName\(\s*quoteFacts,\s*quote\?\.summary\s*\),\s*prefillCustomerName/,
    );
    expect(src).toMatch(/prefillFacts=\{stepFacts\}/);
  });
});
