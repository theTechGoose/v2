/**
 * REQ-1119 (LOOP-007 cycle 3, q3-45 / q3-46 / q3-47) — the invoice's Bill-to
 * phone follows the ONE phone rule (REQ-1080, customerPhoneE164).
 *
 * q3-45: the New invoice form took "843-555-0145 x12" in Bill to → Phone,
 * showed it as "(843) 555-0145", the send sheet recommended "Text + Email",
 * and the send came back "The text didn't go through: invalid phone: …".
 *
 *  - newInvoiceFieldErrors (shared/documents/invoice-form.ts) flags the bill
 *    phone the way it flags the bill email: `billPhone: customer.invalidPhone`.
 *  - recommendedChannel / defaultSendChannel / channelNeedsKey
 *    (front-end/lib/send-dialog.ts) never count a phone the send path cannot
 *    parse as textable — they recommend email and give Text a hint.
 */
import { newInvoiceFieldErrors } from "../../shared/documents/invoice-form.ts";
import {
  channelNeedsKey,
  defaultSendChannel,
  recommendedChannel,
} from "../../front-end/lib/send-dialog.ts";
import { invoiceSendContact } from "../../front-end/lib/invoice-send-sheet.ts";

const EXT = "843-555-0145 x12";

// the bill-to phone is a new input of the rule; pass it through a variable
// so the call compiles against today's signature and fails on behaviour
const form = (billPhone: string) => {
  const f = { newClient: false, billEmail: "", billPhone };
  return f as Parameters<typeof newInvoiceFieldErrors>[0];
};

describe("REQ-1119 q3-45 the New invoice form's Bill-to phone follows the one phone rule", () => {
  test.each([EXT, "(843) 555-2345 ext 4", "555-12"])(
    "REQ-1119 a Bill-to phone '%s' is refused on the billPhone field",
    (billPhone) => {
      expect(newInvoiceFieldErrors(form(billPhone))).toEqual({
        billPhone: "customer.invalidPhone",
      });
    },
  );
  test.each(["", "(843) 555-0145", "+1 512 655 0123"])(
    "REQ-1119 a Bill-to phone '%s' (blank or one the send path can text) is fine",
    (billPhone) => {
      expect(newInvoiceFieldErrors(form(billPhone))).toEqual({});
    },
  );
});

describe("REQ-1119 q3-45 the send sheet never recommends a text to a phone the send path refuses", () => {
  const greg = { email: "greg@example.com", phoneNumber: EXT };
  test("REQ-1119 recommendedChannel with an email and an extension phone recommends email", () => {
    expect(recommendedChannel(greg)).toBe("email");
  });
  test("REQ-1119 defaultSendChannel with an email and an extension phone starts on email", () => {
    expect(defaultSendChannel(greg)).toBe("email");
  });
  test("REQ-1119 channelNeedsKey gives Text and Text + Email a hint for an extension phone", () => {
    expect(channelNeedsKey("sms", greg)).toBeDefined();
    expect(channelNeedsKey("both", greg)).toBeDefined();
    expect(channelNeedsKey("email", greg)).toBeUndefined();
  });
  test("REQ-1119 an invoice billed to '843-555-0145 x12' opens the sheet on email, not Text + Email", () => {
    const contact = invoiceSendContact(
      { billTo: { name: "Greg", email: "greg@example.com", phoneNumber: EXT } },
      null,
    );
    expect(recommendedChannel(contact)).toBe("email");
    expect(defaultSendChannel(contact)).toBe("email");
  });
});
