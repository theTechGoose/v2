/**
 * REQ-656 (demo-loop cycle 5, M9, run r37f88707) — "Job done, need to
 * invoice", typed, opens the invoice flow instead of drafting a quote.
 *
 * Pair 8 typed the starter chip's words in a new chat ("Trabajo terminado,
 * necesito facturar: Jorge Ruiz, jorge.ruiz@example.com, … $200. Que pague
 * hoy.") and got "Q-002 · Cotización redactada". The server now answers
 * with the offer on its reply's payload (`invoiceFlow`), and the chat opens
 * the chip's flow from it, prefilled with the words, the amount and who to
 * bill.
 *
 *   shared/quote-flow/chat-invoice-flow-offer.ts   invoiceFlowOfferOf,
 *                                                  liveInvoiceFlowOffer,
 *                                                  arrivedInvoiceFlowOffer
 *   front-end/islands/AsstChat.tsx                 opens it on arrival; the
 *                                                  [data-cy=msg-invoice-flow-offer] button
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/quote-flow/chat-invoice-flow-offer");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const SAID =
  "Trabajo terminado, necesito facturar: Jorge Ruiz, jorge.ruiz@example.com, sacamos un refrigerador y una lavadora viejos, $200. Que pague hoy.";
const OFFER = {
  details: SAID,
  amountCents: 20_000,
  customerName: "Jorge Ruiz",
  customerEmail: "jorge.ruiz@example.com",
};

describe("REQ-656 M9 invoiceFlowOfferOf", () => {
  test("REQ-656 reads the server's payload; junk is no offer", () => {
    const { invoiceFlowOfferOf } = mod();
    expect(invoiceFlowOfferOf({ invoiceFlow: OFFER })).toEqual(OFFER);
    expect(invoiceFlowOfferOf({ invoiceFlow: { details: "  Job done  " } }))
      .toEqual({ details: "Job done" });
    expect(invoiceFlowOfferOf({ invoiceFlow: { details: "" } }))
      .toBeUndefined();
    expect(
      invoiceFlowOfferOf({ invoiceFlow: { details: "x", amountCents: -5 } }),
    ).toEqual({ details: "x" });
    expect(invoiceFlowOfferOf(null)).toBeUndefined();
    expect(invoiceFlowOfferOf({ draftOffer: {} })).toBeUndefined();
  });
});

describe("REQ-656 M9 liveInvoiceFlowOffer / arrivedInvoiceFlowOffer", () => {
  const user = { id: "m1", role: "user", kind: "text", content: SAID };
  const reply = {
    id: "m2",
    role: "assistant",
    kind: "text",
    payload: { invoiceFlow: OFFER },
  };
  test("REQ-656 the newest assistant reply carries it while no job is bound", () => {
    const { liveInvoiceFlowOffer } = mod();
    expect(liveInvoiceFlowOffer([user, reply], null)).toEqual({
      id: "m2",
      offer: OFFER,
    });
    expect(liveInvoiceFlowOffer([user, reply], "q-1")).toBeUndefined();
    expect(liveInvoiceFlowOffer([reply, { ...user, id: "m3" }], null))
      .toBeUndefined();
  });
  test("REQ-656 a reply that just arrived with it opens the flow; one without does not", () => {
    const { arrivedInvoiceFlowOffer } = mod();
    expect(arrivedInvoiceFlowOffer([user, reply])).toEqual(OFFER);
    expect(arrivedInvoiceFlowOffer([user, { ...reply, payload: {} }]))
      .toBeUndefined();
  });
});

describe("REQ-656 M9 the chat wires it", () => {
  const src = read("front-end/islands/AsstChat.tsx");
  test("REQ-656 AsstChat opens the invoice flow from the reply and offers the button", () => {
    expect(src).toMatch(/arrivedInvoiceFlowOffer\(/);
    expect(src).toMatch(/liveInvoiceFlowOffer\(/);
    expect(src).toMatch(/data-cy="msg-invoice-flow-offer"/);
    expect(src).toMatch(/startInvoiceFlow\(offer\)/);
    expect(src).toMatch(/startInvoiceFlow\(invoiceFlowOffer\.offer\)/);
  });
  test("REQ-656 en and es carry the button and the replies", () => {
    for (const d of [en, es]) {
      expect(d["asstChat.invoiceFlowOffer"]).toBeTruthy();
      for (const k of ["start", "startName", "startAmount", "startPlain"]) {
        expect(d[`chatCoordinator.jobDoneInvoice.${k}`]).toBeTruthy();
      }
      expect(d["chatCoordinator.billing.jobDoneSendNow"]).toMatch(/\{date\}/);
    }
  });
});
