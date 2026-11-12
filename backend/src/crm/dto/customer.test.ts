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
