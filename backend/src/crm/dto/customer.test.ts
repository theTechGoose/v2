// REQ-278 (demo M16): the customer DTO gate refuses a malformed phone or
// email with a 400 that names a dictionary key — at save time, not send time.
import { assertEquals, assertThrows } from "#std/assert";
import { parseCreateCustomer, parseUpdateCustomer } from "./customer.ts";

const BAD_PHONES = ["123", "555-12", "512-555-01"];
const BAD_EMAILS = ["davis@@gmail", "carl@", "carl@x"];

function statusOf(fn: () => unknown): { status?: number; message: string } {
  try {
    fn();
  } catch (e) {
    return e as { status?: number; message: string };
  }
  throw new Error("expected a throw");
}

for (const phoneNumber of BAD_PHONES) {
  Deno.test(`REQ-278 M16 parseCreateCustomer rejects phone ${phoneNumber} with a 400`, () => {
    const err = statusOf(() =>
      parseCreateCustomer({ name: "Ann", phoneNumber })
    );
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidPhone");
  });
  Deno.test(`REQ-278 M16 parseUpdateCustomer rejects phone ${phoneNumber} with a 400`, () => {
    const err = statusOf(() => parseUpdateCustomer({ phoneNumber }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidPhone");
  });
}

for (const email of BAD_EMAILS) {
  Deno.test(`REQ-278 M16 parseCreateCustomer rejects email ${email} with a 400`, () => {
    const err = statusOf(() => parseCreateCustomer({ name: "Ann", email }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidEmail");
  });
  Deno.test(`REQ-278 M16 parseUpdateCustomer rejects email ${email} with a 400`, () => {
    const err = statusOf(() => parseUpdateCustomer({ email }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidEmail");
  });
}

Deno.test("REQ-278 M16 a good or blank contact still parses", () => {
  const c = parseCreateCustomer({
    name: "Ann",
    phoneNumber: "(512) 555-1234",
    email: "ann@client.com",
  });
  assertEquals(c.phoneNumber, "(512) 555-1234");
  assertEquals(parseCreateCustomer({ name: "Bo" }).name, "Bo");
  // clearing a field on edit is not a format error
  assertEquals(parseUpdateCustomer({ email: "", phoneNumber: "" }).email, "");
});

Deno.test("REQ-278 M16 a non-format DTO error is still a 400", () => {
  assertThrows(() => parseCreateCustomer({ name: 42 }));
  const err = statusOf(() => parseCreateCustomer({ name: 42 }));
  assertEquals(err.status, 400);
});

// REQ-715 (demo-loop cycle 5, m31 + c2-M29 + c3-m43 + c4-M34): a customer
// carries the language they read — "en" | "es" — set when they are created,
// changed or cleared ("") on edit; anything else is refused with a 400.
Deno.test("REQ-715 m31 parseCreateCustomer keeps the customer's language (en | es)", () => {
  assertEquals(
    parseCreateCustomer({ name: "Carmen", language: "es" }).language,
    "es",
  );
  assertEquals(
    parseCreateCustomer({ name: "Bob", language: "en" }).language,
    "en",
  );
  assertEquals(parseCreateCustomer({ name: "Bo" }).language, undefined);
  // the form's "Not set" is no language at all, never a stored ""
  assertEquals(
    "language" in parseCreateCustomer({ name: "Bo", language: "" }),
    false,
  );
});

Deno.test("REQ-715 m31 parseUpdateCustomer sets the language, or clears it with ''", () => {
  assertEquals(parseUpdateCustomer({ language: "es" }).language, "es");
  assertEquals(parseUpdateCustomer({ language: "" }).language, "");
});

Deno.test("REQ-715 m31 a language other than en | es is refused with a 400", () => {
  for (const language of ["fr", "spanish", 7]) {
    assertEquals(
      statusOf(() => parseCreateCustomer({ name: "Ann", language })).status,
      400,
    );
    assertEquals(statusOf(() => parseUpdateCustomer({ language })).status, 400);
  }
});

// REQ-1080 (LOOP-007 cycle 2, q2-69): the DTO gate enforces REQ-352's
// "a customer name is required" — a direct POST/PUT cannot store a blank
// name — and refuses a phone carrying an extension ("ext 9"), which the SMS
// send path cannot dial (REQ-278).
for (const name of ["", "   ", "\t \n"]) {
  Deno.test(`REQ-1080 q2-69 parseCreateCustomer refuses name ${JSON.stringify(name)} with 400 customer.nameRequired`, () => {
    const err = statusOf(() => parseCreateCustomer({ name }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.nameRequired");
  });
  Deno.test(`REQ-1080 q2-69 parseUpdateCustomer refuses name ${JSON.stringify(name)} with 400 customer.nameRequired`, () => {
    const err = statusOf(() => parseUpdateCustomer({ name }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.nameRequired");
  });
}

Deno.test("REQ-1080 q2-69 parseCreateCustomer trims the name it keeps", () => {
  assertEquals(parseCreateCustomer({ name: "  Ann Lee  " }).name, "Ann Lee");
});

Deno.test("REQ-1080 q2-69 parseUpdateCustomer without a name still parses (name stays optional on edit)", () => {
  assertEquals(parseUpdateCustomer({ notes: "x" }).name, undefined);
});

for (const phoneNumber of ["+1 (843) 555-0124 ext 9", "+1 843 555 0124 x9"]) {
  Deno.test(`REQ-1080 q2-69 parseCreateCustomer refuses phone ${phoneNumber} with 400 customer.invalidPhone`, () => {
    const err = statusOf(() => parseCreateCustomer({ name: "Ann", phoneNumber }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidPhone");
  });
  Deno.test(`REQ-1080 q2-69 parseUpdateCustomer refuses phone ${phoneNumber} with 400 customer.invalidPhone`, () => {
    const err = statusOf(() => parseUpdateCustomer({ phoneNumber }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidPhone");
  });
}

// REQ-1141 (LOOP-007 cycle 3, q3-73): a customer name (and business name) is
// capped at 120 characters — the same MAX_NAME the inquiry store clips to. A
// 308-character name was accepted and filled the phone screen as a 486 px h1.
const NAME_121 = "A".repeat(121);
const NAME_120 = "B".repeat(120);
Deno.test("REQ-1141 q3-73 parseCreateCustomer refuses a 121-character name with 400 customer.nameTooLong", () => {
  const err = statusOf(() => parseCreateCustomer({ name: NAME_121 }));
  assertEquals(err.status, 400);
  assertEquals(err.message, "customer.nameTooLong");
});
Deno.test("REQ-1141 q3-73 parseCreateCustomer refuses the QA's 308-character name with 400 customer.nameTooLong", () => {
  const err = statusOf(() => parseCreateCustomer({ name: "<b>x</b>" + "Z".repeat(300) }));
  assertEquals(err.status, 400);
  assertEquals(err.message, "customer.nameTooLong");
});
Deno.test("REQ-1141 q3-73 parseUpdateCustomer refuses a 121-character name with 400 customer.nameTooLong", () => {
  const err = statusOf(() => parseUpdateCustomer({ name: NAME_121 }));
  assertEquals(err.status, 400);
  assertEquals(err.message, "customer.nameTooLong");
});
Deno.test("REQ-1141 q3-73 parseCreateCustomer refuses a 121-character business name with 400 customer.nameTooLong", () => {
  const err = statusOf(() => parseCreateCustomer({ name: "Ann", businessName: NAME_121 }));
  assertEquals(err.status, 400);
  assertEquals(err.message, "customer.nameTooLong");
});
Deno.test("REQ-1141 q3-73 parseUpdateCustomer refuses a 121-character business name with 400 customer.nameTooLong", () => {
  const err = statusOf(() => parseUpdateCustomer({ businessName: NAME_121 }));
  assertEquals(err.status, 400);
  assertEquals(err.message, "customer.nameTooLong");
});
Deno.test("REQ-1141 q3-73 a name of exactly 120 characters is kept whole (create and update)", () => {
  assertEquals(parseCreateCustomer({ name: NAME_120 }).name, NAME_120);
  assertEquals(parseUpdateCustomer({ name: NAME_120 }).name, NAME_120);
});
Deno.test("REQ-1141 q3-73 the limit counts the trimmed name — 120 characters plus padding passes", () => {
  assertEquals(parseCreateCustomer({ name: `  ${NAME_120}  ` }).name, NAME_120);
});
