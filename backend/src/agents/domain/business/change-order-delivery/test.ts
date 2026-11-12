/**
 * REQ-456 (demo-loop cycle 3, M25) — "Send it to her" on a chat change order
 * looked ignored: the reply said "I've sent you the link to share" while the
 * alert had emailed and texted the CUSTOMER. The reply now reports what was
 * actually delivered to the customer, channel by channel, in the quote send
 * divider's wording.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { changeOrderSentLine } from "./mod.ts";

Deno.test("REQ-456 M25 changeOrderSentLine: emailed, text failed → 'Sent CO-001 to Karen by email (…) — text failed (…)'", () => {
  const line = changeOrderSentLine("en", {
    number: "CO-001",
    name: "Karen Mills",
    emailedTo: "karen.mills@example.com",
    smsFailureReason: "invalid number",
  });
  assertEquals(
    line,
    "Sent CO-001 to Karen Mills by email (karen.mills@example.com) — text failed (invalid number).",
  );
});

Deno.test("REQ-456 M25 changeOrderSentLine: emailed and texted names both", () => {
  const line = changeOrderSentLine("en", {
    number: "CO-002",
    name: "Karen",
    emailedTo: "k@x.com",
    textedTo: "+15125550100",
  });
  assertEquals(
    line,
    "Sent CO-002 to Karen by email (k@x.com) and text (+15125550100).",
  );
});

Deno.test("REQ-456 M25 changeOrderSentLine: only one channel on file → no 'failed' for the missing one", () => {
  assertEquals(
    changeOrderSentLine("en", {
      number: "CO-1",
      name: "K",
      emailedTo: "k@x.com",
    }),
    "Sent CO-1 to K by email (k@x.com).",
  );
  assertEquals(
    changeOrderSentLine("en", { number: "CO-1", name: "K", textedTo: "+1512" }),
    "Sent CO-1 to K by text (+1512).",
  );
  assertEquals(
    changeOrderSentLine("en", {
      number: "CO-1",
      name: "K",
      textedTo: "+1512",
      emailFailureReason: "bounced",
    }),
    "Sent CO-1 to K by text (+1512) — email failed (bounced).",
  );
});

Deno.test("REQ-456 M25 changeOrderSentLine: nothing delivered says so and tells the contractor to share the link", () => {
  const failed = changeOrderSentLine("en", {
    number: "CO-001",
    name: "Karen",
    emailFailureReason: "bounced",
    smsFailureReason: "invalid number",
  });
  assertStringIncludes(failed, "CO-001");
  assertStringIncludes(failed, "not sent");
  assertStringIncludes(failed, "bounced");
  assertStringIncludes(failed, "invalid number");
  assertStringIncludes(failed, "approval link");
  assert(!/^Sent /.test(failed), failed);

  const noContact = changeOrderSentLine("en", {
    number: "CO-001",
    name: "Karen",
  });
  assertStringIncludes(noContact, "no email or phone");
  assertStringIncludes(noContact, "approval link");
});

Deno.test("REQ-456 M25 changeOrderSentLine: Spanish", () => {
  assertEquals(
    changeOrderSentLine("es", {
      number: "CO-001",
      name: "Karen",
      emailedTo: "k@x.com",
      smsFailureReason: "número inválido",
    }),
    "Envié CO-001 a Karen por correo (k@x.com) — falló el mensaje de texto (número inválido).",
  );
});

Deno.test("REQ-456 M25 changeOrderSentLine: a developer 'no recipient: …' reason reads as the localized 'no recipient'", () => {
  const line = changeOrderSentLine("en", {
    number: "CO-001",
    name: "K",
    emailedTo: "k@x.com",
    smsFailureReason: "no recipient: pass `to`",
  });
  assertStringIncludes(line, "text failed (no recipient)");
});

/** REQ-588 (demo-loop cycle 4, M29): a reason that is a lang key (SmsService
 *  answers "sms.fictionalNumber") is worded, never shown raw. */
Deno.test("REQ-588 M29 changeOrderSentLine: an sms.* reason key is translated, not shown raw", () => {
  const en = changeOrderSentLine("en", {
    number: "CO-001",
    name: "Carol Henderson",
    smsFailureReason: "sms.fictionalNumber",
  });
  assert(!en.includes("sms.fictionalNumber"), en);
  assertStringIncludes(en, "reserved test number");
  const es = changeOrderSentLine("es", {
    number: "CO-001",
    name: "Carol Henderson",
    emailedTo: "carol@example.com",
    smsFailureReason: "sms.invalidNumber",
  });
  assert(!es.includes("sms.invalidNumber"), es);
  assertStringIncludes(es, "no es un teléfono válido");
});

/** REQ-681 (demo-loop cycle 5, m12): a phone that can't take texts is not
 *  texted at all, so the reply says "not texted: <reason>", never
 *  "text failed" (which read as a failed attempt). */
Deno.test("REQ-681 m12 changeOrderSentLine: emailed + a skipped text reads 'not texted: <reason>', never 'text failed'", () => {
  const line = changeOrderSentLine("en", {
    number: "CO-001",
    name: "Maria",
    emailedTo: "maria@example.com",
    smsSkippedReason: "sms.fictionalNumber",
  });
  assertStringIncludes(
    line,
    "Sent CO-001 to Maria by email (maria@example.com) — not texted: that's a reserved test number",
  );
  assert(!line.includes("text failed"), line);
  const es = changeOrderSentLine("es", {
    number: "CO-001",
    name: "Maria",
    emailedTo: "maria@example.com",
    smsSkippedReason: "sms.fictionalNumber",
  });
  assertStringIncludes(es, "sin mensaje de texto: ese es un número de prueba");
  assert(!es.includes("falló el mensaje de texto"), es);
});

Deno.test("REQ-681 m12 changeOrderSentLine: nothing delivered and the text skipped names the reason, not a failure", () => {
  const line = changeOrderSentLine("en", {
    number: "CO-002",
    name: "Maria",
    emailFailureReason: "bounced",
    smsSkippedReason: "sms.fictionalNumber",
  });
  assertStringIncludes(line, "email: bounced");
  assertStringIncludes(line, "text: that's a reserved test number");
  assert(!line.includes("text failed"), line);
  // Only a phone that can't take texts on file → still says why, and never
  // "has no email or phone on file".
  const only = changeOrderSentLine("en", {
    number: "CO-003",
    name: "Maria",
    smsSkippedReason: "sms.fictionalNumber",
  });
  assertStringIncludes(only, "text: that's a reserved test number");
  assert(!only.includes("no email or phone on file"), only);
});
