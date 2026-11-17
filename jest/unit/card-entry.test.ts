/**
 * REQ-213 — the flip card's pure rules: the brand, the Luhn check, the number and expiry
 * formatting, the draft's validity, and the server's decision mapping.
 */
import {
  brandOf,
  cardDraftValid,
  cardPayDecision,
  cvcLengthFor,
  digitsOf,
  formatCardNumber,
  formatExpiry,
  luhnValid,
  parseExpiry,
  paymentMethodForm,
} from "../../shared/payments/card-entry.ts";

describe("REQ-213 card-entry — brand and Luhn", () => {
  test("the brand is read off the leading digits", () => {
    expect(brandOf("4")).toBe("visa");
    expect(brandOf("4242424242424242")).toBe("visa");
    expect(brandOf("5")).toBe("mastercard");
    expect(brandOf("5555555555554444")).toBe("mastercard");
    expect(brandOf("2223003122003222")).toBe("mastercard");
    expect(brandOf("378282246310005")).toBe("amex");
    expect(brandOf("34")).toBe("amex");
    expect(brandOf("6011111111111117")).toBe("discover");
    expect(brandOf("65")).toBe("discover");
    expect(brandOf("")).toBe("none");
    expect(brandOf("9")).toBe("none");
  });
  test("Luhn", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4000000000000002")).toBe(true);
    expect(luhnValid("378282246310005")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("")).toBe(false);
  });
  test("the CVC is four digits on Amex, three elsewhere", () => {
    expect(cvcLengthFor("amex")).toBe(4);
    expect(cvcLengthFor("visa")).toBe(3);
    expect(cvcLengthFor("none")).toBe(3);
  });
});

describe("REQ-213 card-entry — formatting", () => {
  test("digits only", () => {
    expect(digitsOf("4242 4242-4242.4242x")).toBe("4242424242424242");
  });
  test("the number groups in fours, Amex 4-6-5, and never past the brand's length", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("42424")).toBe("4242 4");
    expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005");
    expect(formatCardNumber("42424242424242421234")).toBe(
      "4242 4242 4242 4242",
    );
    expect(formatCardNumber("")).toBe("");
  });
  test("the expiry is MM/YY as it is typed", () => {
    expect(formatExpiry("1")).toBe("1");
    expect(formatExpiry("12")).toBe("12/");
    expect(formatExpiry("123")).toBe("12/3");
    expect(formatExpiry("1234")).toBe("12/34");
    expect(formatExpiry("12/34")).toBe("12/34");
    expect(formatExpiry("123456")).toBe("12/34");
    expect(formatExpiry("1/")).toBe("1");
  });
  test("the expiry parses to a month and a four-digit year, and refuses the past", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(parseExpiry("12/34", now)).toEqual({ month: 12, year: 2034 });
    expect(parseExpiry("11/26", now)).toEqual({ month: 11, year: 2026 });
    expect(parseExpiry("10/26", now)).toBeNull();
    expect(parseExpiry("13/30", now)).toBeNull();
    expect(parseExpiry("00/30", now)).toBeNull();
    expect(parseExpiry("1/3", now)).toBeNull();
    expect(parseExpiry("", now)).toBeNull();
  });
});

describe("REQ-213 card-entry — the draft", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const good = {
    number: "4242 4242 4242 4242",
    holder: "Ana Torres",
    expiry: "12/34",
    cvc: "123",
  };
  test("a complete, valid draft is ok", () => {
    expect(cardDraftValid(good, now)).toEqual({ ok: true });
    expect(
      cardDraftValid(
        { ...good, number: "3782 822463 10005", cvc: "1234" },
        now,
      ),
    ).toEqual({ ok: true });
  });
  test("the first bad field is named", () => {
    expect(cardDraftValid({ ...good, number: "4242 4242 4242 4241" }, now))
      .toEqual({ ok: false, field: "number" });
    expect(cardDraftValid({ ...good, number: "4242" }, now)).toEqual({
      ok: false,
      field: "number",
    });
    expect(cardDraftValid({ ...good, holder: "  " }, now)).toEqual({
      ok: false,
      field: "holder",
    });
    expect(cardDraftValid({ ...good, expiry: "10/26" }, now)).toEqual({
      ok: false,
      field: "expiry",
    });
    expect(cardDraftValid({ ...good, cvc: "12" }, now)).toEqual({
      ok: false,
      field: "cvc",
    });
    expect(
      cardDraftValid({ ...good, number: "3782 822463 10005", cvc: "123" }, now),
    ).toEqual({ ok: false, field: "cvc" });
  });
  test("the Stripe form carries the card and the holder, nothing else", () => {
    const form = paymentMethodForm(good);
    expect(form.get("type")).toBe("card");
    expect(form.get("card[number]")).toBe("4242424242424242");
    expect(form.get("card[exp_month]")).toBe("12");
    expect(form.get("card[exp_year]")).toBe("2034");
    expect(form.get("card[cvc]")).toBe("123");
    expect(form.get("billing_details[name]")).toBe("Ana Torres");
    expect([...form.keys()].length).toBe(6);
  });
});

describe("REQ-213 card-entry — the server's answer", () => {
  test("paid, needs 3DS, declined, stale, already paid, error", () => {
    expect(
      cardPayDecision(200, {
        ok: true,
        status: "succeeded",
        paymentIntentId: "pi_1",
        balanceCents: 0,
      }),
    )
      .toEqual({ kind: "paid", paymentIntentId: "pi_1", balanceCents: 0 });
    expect(
      cardPayDecision(200, {
        ok: false,
        status: "requires_action",
        paymentIntentId: "pi_2",
        clientSecret: "pi_2_secret_x",
      }),
    )
      .toEqual({
        kind: "requires_action",
        paymentIntentId: "pi_2",
        clientSecret: "pi_2_secret_x",
      });
    expect(
      cardPayDecision(402, {
        ok: false,
        reason: "declined",
        message: "Your card was declined.",
      }),
    )
      .toEqual({ kind: "declined", message: "Your card was declined." });
    expect(
      cardPayDecision(409, {
        ok: false,
        reason: "stale_balance",
        balanceCents: 5000,
        version: 3,
      }),
    )
      .toEqual({ kind: "stale_balance", balanceCents: 5000, version: 3 });
    expect(cardPayDecision(409, { ok: false, reason: "already_paid" })).toEqual(
      { kind: "already_paid" },
    );
    expect(cardPayDecision(404, { ok: false, reason: "card_unavailable" }))
      .toEqual({ kind: "error", reason: "card_unavailable" });
    expect(cardPayDecision(500, {})).toEqual({ kind: "error", reason: "500" });
  });
});
