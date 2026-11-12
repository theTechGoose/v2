/**
 * REQ-583 (demo-loop cycle 4, M2) — the chat's invoice card offers "Send now"
 * for an invoice that has not gone out yet.
 *
 * Pair 3 asked "Invoice Maria for the deep clean" and got "…The $320 invoice
 * (INV-001) hasn't gone out yet — it's scheduled for Nov 19" with no button;
 * pair 9 the same in Spanish. The answer now carries the scheduled invoice as
 * its card (payload `offerSend: true`, `number`), and the card's Send-now
 * button posts its own words ("Send INV-001 now"), which the server reads as
 * the send (backend REQ-583 tests). A later card for the same invoice (sent,
 * or offered again) retires the button on the older one. A scheduled or paid
 * card's chip reads Scheduled / Paid — never the quote card's "Draft".
 *
 * Shared logic: shared/quote-flow/chat-invoice-card.ts.
 */
import * as fs from "fs";
import * as path from "path";
import {
  invoiceCardChipKey,
  invoiceCardSendOffer,
} from "../../shared/quote-flow/chat-invoice-card";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** What AnswerBilling puts on a scheduled invoice's card. */
const SCHEDULED = {
  actionType: "invoice",
  status: "scheduled",
  invoiceId: "inv-1",
  number: "INV-001",
  quoteId: "q-1",
  offerSend: true,
  lineItems: [{ description: "Job total", amountCents: 32_000 }],
  totalCents: 32_000,
};

describe("REQ-583 M2: the invoice card's Send now", () => {
  test("REQ-583: a scheduled invoice's card offers Send now for its number", () => {
    expect(invoiceCardSendOffer(SCHEDULED, [])).toEqual({
      invoiceId: "inv-1",
      number: "INV-001",
    });
    expect(invoiceCardSendOffer({ ...SCHEDULED, status: "draft" }, []))
      .toEqual({ invoiceId: "inv-1", number: "INV-001" });
  });

  test("REQ-583: no offer flag, a sent or paid card, a quote card, or no number → no button", () => {
    expect(invoiceCardSendOffer({ ...SCHEDULED, offerSend: undefined }, []))
      .toBeNull();
    expect(invoiceCardSendOffer({ ...SCHEDULED, status: "sent" }, []))
      .toBeNull();
    expect(invoiceCardSendOffer({ ...SCHEDULED, status: "paid" }, []))
      .toBeNull();
    expect(invoiceCardSendOffer({ ...SCHEDULED, actionType: "quote" }, []))
      .toBeNull();
    expect(invoiceCardSendOffer({ ...SCHEDULED, number: undefined }, []))
      .toBeNull();
    expect(invoiceCardSendOffer(undefined, [])).toBeNull();
  });

  test("REQ-583: a later card for the same invoice (sent, or offered again) retires the older button; another invoice's card doesn't", () => {
    const sent = { ...SCHEDULED, status: "sent", offerSend: undefined };
    expect(invoiceCardSendOffer(SCHEDULED, [sent])).toBeNull();
    expect(invoiceCardSendOffer(SCHEDULED, [SCHEDULED])).toBeNull();
    expect(
      invoiceCardSendOffer(SCHEDULED, [
        { ...sent, invoiceId: "inv-2", number: "INV-002" },
        { kind: "text" },
        null,
      ]),
    ).toEqual({ invoiceId: "inv-1", number: "INV-001" });
  });

  test("REQ-583: the card's chip reads Scheduled / Paid / Draft from the invoice states; sent and viewed are unchanged", () => {
    expect(invoiceCardChipKey("scheduled")).toBe("invoices.state.scheduled");
    expect(invoiceCardChipKey("paid")).toBe("invoices.state.paid");
    expect(invoiceCardChipKey("draft")).toBe("invoices.state.draft");
    expect(invoiceCardChipKey("sent")).toBe("status.sent");
    expect(invoiceCardChipKey("viewed")).toBe("status.viewed");
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const s of ["scheduled", "paid", "draft", "sent", "viewed"]) {
      expect(en[invoiceCardChipKey(s)]).toBeTruthy();
      expect(es[invoiceCardChipKey(s)]).toBeTruthy();
    }
  });

  test("REQ-583: the button's label and words exist in en + es and carry the number", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const dict of [en, es]) {
      expect(dict["asstChat.invoiceCard.sendNow"]).toBeTruthy();
      expect(dict["asstChat.invoiceCard.sendNowText"]).toContain("{number}");
    }
    expect(en["asstChat.invoiceCard.sendNowText"]).toBe("Send {number} now");
    expect(es["asstChat.invoiceCard.sendNowText"]).toBe("Envía {number} ahora");
  });

  test("REQ-583: the island's invoice card renders the button from the helper and posts its words, never the quote card's buttons", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const start = src.indexOf("isInvoiceCardPayload(m.payload)");
    const end = src.indexOf('if (m.kind === "action_card") {', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const branch = src.slice(start, end);
    expect(branch).toMatch(/invoiceCardSendOffer\(/);
    expect(branch).toMatch(/asstChat\.invoiceCard\.sendNowText/);
    expect(branch).toMatch(/data-cy="chat-invoice-card-send"/);
    expect(branch).toMatch(/sendText\(/);
    expect(branch).toMatch(/invoiceCardChipKey\(/);
    expect(branch).not.toMatch(/lockActionCard|Re-open the quote/);
  });
});
