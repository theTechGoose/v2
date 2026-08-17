/**
 * PDF p14 (04 SIGN HERE) — the contract signature block:
 *   "By signing below, <client> agrees to everything above."
 *   CONTRACTOR column: business name (e.g. HANS LLC), "By: Hans Pedersen",
 *   "Date: May 23, 2026".
 *   CUSTOMER column: "YOUR Signature" / "Sign & type name below".
 *
 * Target: shared/quote-flow/signature-block.ts
 */
import { buildSignatureBlock } from "../../shared/quote-flow/signature-block";

describe("buildSignatureBlock", () => {
  const block = buildSignatureBlock({
    clientName: "Green Goblin",
    contractorName: "Hans Pedersen",
    businessName: "HANS LLC",
    signedDateISO: "2026-05-23",
  });

  it("states the agreement line with the client's name", () => {
    expect(block.agreementLine).toBe(
      "By signing below, Green Goblin agrees to everything above.",
    );
  });

  it("contractor column is headed by the BUSINESS name", () => {
    expect(block.contractor.heading).toBe("HANS LLC");
  });

  it("contractor column carries 'By: <person>' under the business", () => {
    expect(block.contractor.byLine).toBe("By: Hans Pedersen");
  });

  it("contractor column shows the signature date", () => {
    expect(block.contractor.dateLine).toMatch(/May 23, 2026/);
  });

  it("customer column is headed 'YOUR Signature' (p14)", () => {
    expect(block.customer.heading).toMatch(/your signature/i);
  });

  it("customer column instructs 'Sign & type name below'", () => {
    expect(block.customer.instruction).toMatch(/sign & type name below/i);
  });

  it("falls back to the contractor's personal name when no business name exists", () => {
    const solo = buildSignatureBlock({
      clientName: "Green Goblin",
      contractorName: "Hans Pedersen",
      businessName: undefined,
      signedDateISO: "2026-05-23",
    });
    expect(solo.contractor.heading).toBe("Hans Pedersen");
  });
});
