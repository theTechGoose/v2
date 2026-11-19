/**
 * REQ-1032 (LOOP-007 q2, q2-15) — "Same Zelle phone printed as '(512) 555-0700' and as raw
 * '5125550700' on one invoice". The pay buttons (shared/payments/pay-links.ts payButtons) are what
 * both the invoice email's "Ways to pay" block and the public /i "Pay online" card print. A
 * phone-shaped handle carries a display form — "(512) 555-0700", the REQ-326 / REQ-965 phone — while
 * `value` stays the raw handle, so the Copy button still copies the digits. Email, @name and
 * $cashtag handles display exactly as typed.
 */
import { payButtons, projectPayMethods } from "../../shared/payments/pay-links";

type AnyButton = Record<string, unknown>;

describe("REQ-1032 (q2-15) payButtons: a phone pay handle carries a formatted display, the raw value to copy", () => {
  test("REQ-1032 Zelle '5125550700': display '(512) 555-0700', value '5125550700'", () => {
    const [b] = payButtons(
      projectPayMethods({ zelle: { enabled: true, handle: "5125550700" } }),
      {},
    ) as AnyButton[];
    expect(b).toMatchObject({ kind: "copy", key: "zelle", value: "5125550700" });
    expect(b.display).toBe("(512) 555-0700");
  });

  test("REQ-1032 Zelle '+1 (512) 555-0700': display '(512) 555-0700'", () => {
    const [b] = payButtons(
      projectPayMethods({ zelle: { enabled: true, handle: "+1 (512) 555-0700" } }),
      {},
    ) as AnyButton[];
    expect(b.display).toBe("(512) 555-0700");
  });

  test("REQ-1032 an email Zelle, an @name Venmo and a $cashtag Cash App display exactly as typed", () => {
    const buttons = payButtons(
      projectPayMethods({
        zelle: { enabled: true, handle: "pay@acme.test" },
        venmo: { enabled: true, handle: "@acme-roof" },
        cashapp: { enabled: true, cashtag: "$acmeroof" },
      }),
      { amountCents: 6500 },
    ) as AnyButton[];
    const zelle = buttons.find((b) => b.key === "zelle")!;
    expect(zelle.value).toBe("pay@acme.test");
    expect(zelle.display).toBe("pay@acme.test");
    const venmo = buttons.find((b) => b.key === "venmo")!;
    expect(venmo.detail).toBe("@acme-roof");
    const cash = buttons.find((b) => b.key === "cashapp")!;
    expect(cash.detail).toBe("$acmeroof");
  });
});
