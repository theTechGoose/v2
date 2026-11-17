/**
 * REQ-557 — demo-loop cycle 4, issue M25: the owner previewing her own
 * CLAIMED invoice on /i/:id saw the customer's note ("You told {who} you
 * paid" / "Le avisaste a {who} que pagaste") and no way to act on it — the
 * Confirm / Didn't-get-it actions lived only on /invoices. For the business's
 * own viewer (`internal: true`) the claimed branch now renders an owner note,
 * "{customer} says they paid by Zelle · ref …", with Confirm received /
 * Didn't get it (POST confirm-payment / reject-claim) and a link to
 * /invoices?open=<id>. The customer keeps ClaimedNote.
 *
 *   shared/documents/owner-claim-note.ts → ownerClaimNoteShown(), ownerClaimNote(),
 *                                          confirmPaymentPath(), rejectClaimPath(),
 *                                          reviewClaimHref()
 *   front-end/islands/OwnerClaimReview.tsx → the note + buttons
 *   front-end/routes/i/[id].tsx           → claimed branch picks owner vs customer
 *   lang/{en,es}.json                     → publicInvoice.ownerClaim.*
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/owner-claim-note");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dict = (l: string) =>
  JSON.parse(read(`lang/${l}.json`)) as Record<string, string>;
const tOf = (l: string) => (k: string, v?: Record<string, string | number>) => {
  const s = dict(l)[k];
  if (typeof s !== "string") throw new Error(`missing ${l} key ${k}`);
  return s.replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
};

const claim = { method: "zelle", amount: 48000, claimedAt: "2026-11-12" };

describe("REQ-557 ownerClaimNoteShown — the business's own viewer of a claimed invoice gets the owner note", () => {
  it("REQ-557 internal + claimed + a payment intent → owner note; the customer (no flag) keeps the customer note", () => {
    const { ownerClaimNoteShown } = mod();
    expect(ownerClaimNoteShown({
      internal: true,
      status: "claimed",
      paymentIntent: claim,
    }, "")).toBe(true);
    expect(ownerClaimNoteShown({ status: "claimed", paymentIntent: claim }, ""))
      .toBe(false);
    expect(ownerClaimNoteShown({
      internal: false,
      status: "claimed",
      paymentIntent: claim,
    }, "")).toBe(false);
  });

  it("REQ-557 nothing to confirm (not claimed, or no intent) → no owner note", () => {
    const { ownerClaimNoteShown } = mod();
    expect(ownerClaimNoteShown({ internal: true, status: "sent" }, "")).toBe(
      false,
    );
    expect(ownerClaimNoteShown({ internal: true, status: "paid" }, "")).toBe(
      false,
    );
    expect(ownerClaimNoteShown({ internal: true, status: "claimed" }, ""))
      .toBe(false);
  });

  it("REQ-557 the in-person override (?as=customer&confirm=1) shows the customer's note to the customer in the room", () => {
    const { ownerClaimNoteShown } = mod();
    const p = { internal: true, status: "claimed", paymentIntent: claim };
    expect(ownerClaimNoteShown(p, "?as=customer&confirm=1")).toBe(false);
    expect(ownerClaimNoteShown(p, "?as=customer")).toBe(true);
  });
});

describe("REQ-557 ownerClaimNote — addressed to the owner, about the customer", () => {
  it("REQ-557 en: '{customer} says they paid by Zelle · ref …'", () => {
    const { ownerClaimNote } = mod();
    const n = ownerClaimNote(tOf("en"), {
      customer: "Juan",
      methodName: "Zelle",
      reference: "ZL-557",
    });
    expect(n.body).toBe("Juan says they paid by Zelle · ref ZL-557.");
    expect(n.heading).toBe("Payment to confirm");
    expect(n.confirm).toBe("Confirm received");
    expect(n.reject).toBe("Didn't get it");
    expect(`${n.heading} ${n.body}`).not.toMatch(/You told/);
  });

  it("REQ-557 es, and no reference → no ref clause", () => {
    const { ownerClaimNote } = mod();
    const n = ownerClaimNote(tOf("es"), {
      customer: "Juan",
      methodName: "Zelle",
    });
    expect(n.body).toBe("Juan dice que pagó por Zelle.");
    expect(`${n.heading} ${n.body}`).not.toMatch(/Le avisaste/);
    expect(n.confirm).toBe("Confirmar recibido");
    expect(n.reject).toBe("No lo recibí");
  });

  it("REQ-557 no customer name → 'Your customer' / 'Tu cliente'", () => {
    const { ownerClaimNote } = mod();
    expect(ownerClaimNote(tOf("en"), { methodName: "Cash" }).body).toBe(
      "Your customer says they paid by Cash.",
    );
    expect(
      ownerClaimNote(tOf("es"), { customer: "  ", methodName: "Efectivo" })
        .body,
    ).toBe("Tu cliente dice que pagó por Efectivo.");
  });

  it("REQ-557 the actions: confirm-payment, reject-claim, and the invoice on /invoices", () => {
    const { confirmPaymentPath, rejectClaimPath, reviewClaimHref } = mod();
    expect(confirmPaymentPath("inv-1")).toBe(
      "/api/invoices/inv-1/confirm-payment",
    );
    expect(rejectClaimPath("inv-1")).toBe("/api/invoices/inv-1/reject-claim");
    expect(reviewClaimHref("inv-1")).toBe("/invoices?open=inv-1");
    expect(reviewClaimHref("a b")).toBe("/invoices?open=a%20b");
  });
});

describe("REQ-557 wiring — route, island and dictionaries", () => {
  it("REQ-557 /i/:id's claimed branch renders OwnerClaimReview for the owner, ClaimedNote otherwise", () => {
    const src = read("front-end/routes/i/[id].tsx");
    expect(src).toContain("ownerClaimNoteShown(invoice, search)");
    const claimedAt = src.indexOf(": claimed\n");
    const ownerAt = src.indexOf("<OwnerClaimedNote", claimedAt);
    const customerAt = src.indexOf("<ClaimedNote", claimedAt);
    expect(claimedAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(claimedAt);
    expect(customerAt).toBeGreaterThan(ownerAt);
    // the owner note is the OwnerClaimReview island
    const helper = src.slice(src.indexOf("function OwnerClaimedNote("));
    expect(helper).toMatch(
      /^function OwnerClaimedNote\([\s\S]*?<OwnerClaimReview/,
    );
  });

  it("REQ-557 the island posts confirm-payment / reject-claim and links to /invoices", () => {
    const src = read("front-end/islands/OwnerClaimReview.tsx");
    expect(src).toContain("confirmPaymentPath(invoiceId)");
    expect(src).toContain("rejectClaimPath(invoiceId)");
    expect(src).toContain("reviewClaimHref(invoiceId)");
    for (
      const cy of [
        "owner-claim-note",
        "owner-claim-confirm",
        "owner-claim-reject",
        "owner-claim-open",
      ]
    ) expect(src).toContain(`data-cy="${cy}"`);
  });

  it("REQ-557 en and es carry every publicInvoice.ownerClaim.* key", () => {
    const en = dict("en");
    const es = dict("es");
    const keys = Object.keys(en).filter((k) =>
      k.startsWith("publicInvoice.ownerClaim.")
    );
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(
      Object.keys(es).filter((k) => k.startsWith("publicInvoice.ownerClaim."))
        .sort(),
    ).toEqual(keys.sort());
    for (const k of keys) expect(en[k]).not.toBe(es[k]);
  });
});
