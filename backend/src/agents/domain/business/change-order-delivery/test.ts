/**
 * REQ-456 (demo-loop cycle 3, M25) — "Send it to her" on a chat change order
 * looked ignored: the reply said "I've sent you the link to share" while the
 * alert had emailed and texted the CUSTOMER. The reply now reports what was
 * actually delivered to the customer, channel by channel, in the quote send
 * divider's wording.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import {
  asksToSendChangeOrder,
  changeOrderSentLine,
  liveUnsentChangeOrder,
  parseSendChangeOrderAsk,
} from "./mod.ts";

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

// ---------------------------------------------------------------------------
// REQ-652 (demo-loop cycle 5, M8): "make a change order" makes it; only an
// explicit send / email / text sends it to the customer.
// ---------------------------------------------------------------------------

Deno.test("REQ-652 M8 asksToSendChangeOrder: the demo's plain 'make' / 'add' asks are not a send", () => {
  for (
    const text of [
      "Make a change order on Q-001: credit $500 for the vanity she supplied",
      "add $400 change order for the extra outlet",
      "Change order for Maria: add fridge cleaning $40",
      "Haz una orden de cambio en Q-001: agrega $300 por pintura",
      "Make a change order for the text on the sign, $50",
      "Change order for Maria: add fridge cleaning $40 but don't send it yet",
      "Add a $200 change order, I'll send it to her later",
      "Add a $200 change order and send it to her tomorrow",
    ]
  ) {
    assertEquals(asksToSendChangeOrder(text), false, text);
  }
});

Deno.test("REQ-652 M8 asksToSendChangeOrder: an explicit send / email / text in the message is a send", () => {
  for (
    const text of [
      "Make a change order for Q-001 and send it to her",
      "Change order for Maria: add fridge cleaning $40. Send it to her.",
      "add $400 change order and email it to Dana",
      "Change order for Maria: add fridge cleaning $40, text it to her",
      "Orden de cambio para María: agrega limpieza de refri $40 y mándasela",
      "Orden de cambio para María: $40 por limpieza. Envíasela por favor",
    ]
  ) {
    assertEquals(asksToSendChangeOrder(text), true, text);
  }
});

Deno.test("REQ-652 M8 parseSendChangeOrderAsk: the Send button's words and a follow-up 'send it' are a send ask", () => {
  assertEquals(parseSendChangeOrderAsk("Send CO-002"), {
    changeOrderNumber: "CO-002",
  });
  assertEquals(parseSendChangeOrderAsk("Enviar CO-010"), {
    changeOrderNumber: "CO-010",
  });
  assertEquals(parseSendChangeOrderAsk("ok send it to her"), {});
  assertEquals(parseSendChangeOrderAsk("Mándasela"), {});
  assertEquals(
    parseSendChangeOrderAsk("Make a change order for $40"),
    undefined,
  );
  assertEquals(parseSendChangeOrderAsk("don't send CO-002"), undefined);
  assertEquals(parseSendChangeOrderAsk("Send INV-001 now"), undefined);
});

Deno.test("REQ-652 M8 liveUnsentChangeOrder: the latest reply's unsent change order, never an older or sent one", () => {
  const unsent = {
    role: "assistant",
    kind: "text",
    payload: {
      changeOrder: {
        kind: "change_order",
        changeOrderId: "co1",
        changeOrderNumber: "CO-001",
        sent: false,
      },
    },
  };
  assertEquals(liveUnsentChangeOrder([unsent]), {
    changeOrderId: "co1",
    number: "CO-001",
  });
  // a later user turn makes it stale
  assertEquals(
    liveUnsentChangeOrder([unsent, { role: "user", kind: "text" }]),
    undefined,
  );
  // already sent
  assertEquals(
    liveUnsentChangeOrder([{
      ...unsent,
      payload: {
        changeOrder: { ...unsent.payload.changeOrder, sent: true },
      },
    }]),
    undefined,
  );
  // an older outcome (no `sent` field) was sent when it was made
  assertEquals(
    liveUnsentChangeOrder([{
      ...unsent,
      payload: {
        changeOrder: { kind: "change_order", changeOrderId: "co1" },
      },
    }]),
    undefined,
  );
});

Deno.test("REQ-652 M8: the not-sent reply and the Send button's keys exist in en and es", () => {
  const read = (l: string) =>
    JSON.parse(
      Deno.readTextFileSync(
        new URL(`../../../../../../lang/${l}.json`, import.meta.url),
      ),
    );
  for (const d of [read("en"), read("es")]) {
    const s = d["chatCoordinator.changeOrder.createdNotSent"];
    assert(typeof s === "string" && s.includes("{number}"), s);
    assert(!/\bSent\b|Envié/.test(s), s);
    assertStringIncludes(d["asstChat.changeOrderLink.send"], "{number}");
  }
  assertStringIncludes(
    read("en")["chatCoordinator.changeOrder.createdNotSent"],
    "not been sent",
  );
  // the button's words are what the chat reads as a send
  assertEquals(
    parseSendChangeOrderAsk(
      read("en")["asstChat.changeOrderLink.send"].replace("{number}", "CO-001"),
    ),
    { changeOrderNumber: "CO-001" },
  );
  assertEquals(
    parseSendChangeOrderAsk(
      read("es")["asstChat.changeOrderLink.send"].replace("{number}", "CO-001"),
    ),
    { changeOrderNumber: "CO-001" },
  );
});
