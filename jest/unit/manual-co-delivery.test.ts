/**
 * REQ-684 — demo-loop cycle 5 (run r37f88707), issue m39: a change order made
 * by hand on /quotes said only "CO-001 created — the customer approves it at
 * its own link." although the alert had already emailed / texted the
 * customer. The chat path said "Sent CO-002 to … by email" (REQ-456). Both
 * paths now word the delivery with ONE shared line:
 *
 *   shared/documents/change-order-sent-line.ts  changeOrderSentLineWith,
 *                                               changeOrderDeliveryOf
 *   front-end/islands/QuotesPage.tsx            renders it after Create / Save
 *
 * Lazy-required so a missing module reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const line = () => require("../../shared/documents/change-order-sent-line");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dict = (lang: "en" | "es") =>
  JSON.parse(read(`lang/${lang}.json`)) as Record<string, string>;
const tr = (lang: "en" | "es") => {
  const d = dict(lang);
  return (key: string, vars: Record<string, string | number> = {}) =>
    (d[key] ?? key).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? `{${k}}`));
};

describe("REQ-684 (m39) changeOrderSentLineWith — the hand-made CO says what reached the customer", () => {
  it("REQ-684 emailed → 'Sent CO-001 to Maria by email (…)'", () => {
    const { changeOrderSentLineWith } = line();
    expect(
      changeOrderSentLineWith(tr("en"), {
        number: "CO-001",
        name: "Maria Lopez",
        emailedTo: "maria@example.com",
      }),
    ).toBe("Sent CO-001 to Maria Lopez by email (maria@example.com).");
  });

  it("REQ-684 emailed, text refused → names the text failure, worded (never the raw sms.* key)", () => {
    const { changeOrderSentLineWith } = line();
    const out = changeOrderSentLineWith(tr("en"), {
      number: "CO-001",
      name: "Maria",
      emailedTo: "maria@example.com",
      smsFailureReason: "sms.fictionalNumber",
    });
    expect(out).toMatch(/^Sent CO-001 to Maria by email \(maria@example\.com\) — text failed \(/);
    expect(out).not.toContain("sms.fictionalNumber");
  });

  it("REQ-684 no contact on file → 'nothing sent — share the link' wording, en and es", () => {
    const { changeOrderSentLineWith } = line();
    expect(
      changeOrderSentLineWith(tr("en"), { number: "CO-001", name: "Maria" }),
    ).toBe(
      "CO-001 was not sent — Maria has no email or phone on file. Copy the approval link below and send it yourself.",
    );
    expect(
      changeOrderSentLineWith(tr("es"), { number: "CO-001", name: "Maria" }),
    ).toContain("CO-001 no se envió");
  });

  it("REQ-684 the alert threw → 'was not sent (reason)'", () => {
    const { changeOrderSentLineWith } = line();
    expect(
      changeOrderSentLineWith(tr("en"), {
        number: "CO-001",
        name: "Maria",
        error: "boom",
      }),
    ).toBe(
      "CO-001 was not sent to Maria (boom). Copy the approval link below and send it yourself.",
    );
  });
});

describe("REQ-684 (m39) changeOrderDeliveryOf — the alert result as the wire's `delivery`", () => {
  it("REQ-684 keeps the per-channel facts, drops number/approvalPath", () => {
    const { changeOrderDeliveryOf } = line();
    expect(
      changeOrderDeliveryOf({
        ok: true,
        customer: {
          number: "CO-001",
          approvalPath: "/co/x?lang=en",
          emailedTo: "m@x.com",
          smsFailureReason: "sms.invalidNumber",
        },
      }),
    ).toEqual({ emailedTo: "m@x.com", smsFailureReason: "sms.invalidNumber" });
  });

  it("REQ-684 no customer result (no contractor) or a thrown alert → error", () => {
    const { changeOrderDeliveryOf } = line();
    expect(changeOrderDeliveryOf({ ok: false, reason: "no_contractor" }))
      .toEqual({ error: "no_contractor" });
    expect(changeOrderDeliveryOf(undefined, "kv down")).toEqual({
      error: "kv down",
    });
  });
});

describe("REQ-684 (m39) the quote panel renders the delivery, not the bare 'created' note", () => {
  const src = () => read("front-end/islands/QuotesPage.tsx");
  it("REQ-684 QuotesPage words create/save through changeOrderSentLineWith", () => {
    expect(src()).toContain("changeOrderSentLineWith");
    expect(src()).toMatch(/data-cy="quote-co-delivery"/);
    expect(src()).toMatch(/data-cy="ledger-co-delivery"/);
  });
  it("REQ-684 the client types the response's delivery", () => {
    expect(read("front-end/clients/change-orders.ts")).toMatch(/delivery\?:/);
  });
});
