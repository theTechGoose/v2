import { assertEquals } from "#std/assert";
import { businessAddressLine, payOptionLines } from "./mod.ts";

// REQ-629 — "Extra Pay and other payment platforms exactly like the website" on the printed bill
Deno.test("REQ-629 payOptionLines: only enabled methods with something to say, in the website's order", () => {
  const lines = payOptionLines({
    zelle: { enabled: true, handle: "pay@a2z.com" },
    venmo: { enabled: true, handle: "@a2z-landscape" },
    cashapp: { enabled: false, cashtag: "$nope" },
    check: { enabled: true, mailTo: "12 Oak St, Austin TX" },
    cash: { enabled: true },
    ach: {
      enabled: true,
      routingNumber: "111000025",
      accountNumberMasked: "1234",
      instructions: "Call for bank details",
    },
    card: { enabled: true, instructions: "I'll text a card link" },
    other: { enabled: true },
  }, "en");
  assertEquals(lines, [
    { label: "Check", value: "Send to: 12 Oak St, Austin TX" },
    { label: "Venmo", value: "@a2z-landscape" },
    { label: "Zelle", value: "pay@a2z.com" },
    { label: "Cash", value: "Cash accepted" },
    { label: "Direct deposit", value: "Call for bank details" },
    { label: "Credit card", value: "I'll text a card link" },
  ]);
  // the routing number is never printed
  assertEquals(JSON.stringify(lines).includes("111000025"), false);
});

Deno.test("REQ-629 payOptionLines: Spanish labels; nothing configured → empty", () => {
  assertEquals(payOptionLines({ check: { enabled: true } }, "es"), [
    { label: "Cheque", value: "Cheque aceptado" },
  ]);
  assertEquals(payOptionLines(undefined, "en"), []);
});

// REQ-805 — "he added Xpress pay and its not showing on his invoices": a payment link the business
// added in Settings is one of its ways to get paid on paper too — by its name, with its link.
Deno.test("REQ-805 payOptionLines: each enabled https payment link prints by its name with its URL, after the methods", () => {
  const lines = payOptionLines({
    venmo: { enabled: true, handle: "@a2z-landscape" },
    links: [
      { id: "l1", name: "Xpress Pay", url: "https://www.xpress-pay.com/a2z", enabled: true },
      { id: "l2", name: "Old link", url: "https://old.example/pay", enabled: false },
      { id: "l3", name: "Unsafe", url: "http://unsafe.example/pay" },
      { id: "l4", name: "", url: "https://noname.example/pay" },
    ],
  } as never, "en");
  assertEquals(lines, [
    { label: "Venmo", value: "@a2z-landscape" },
    { label: "Xpress Pay", value: "https://www.xpress-pay.com/a2z" },
  ]);
});

// REQ-923 — "on the invoice it says 'check accepted' it should say 'send to' <address>"
Deno.test("REQ-923 payOptionLines: a check line reads 'Send to: <address>' — the check's mail-to, else the business address", () => {
  // the business's own mail-to wins
  assertEquals(
    payOptionLines({ check: { enabled: true, mailTo: "PO Box 9, Austin TX" } }, "en", "12 Oak St, Austin, TX 78701"),
    [{ label: "Check", value: "Send to: PO Box 9, Austin TX" }],
  );
  // no mail-to → the business address, never "Check accepted"
  assertEquals(
    payOptionLines({ check: { enabled: true } }, "en", "12 Oak St, Austin, TX 78701"),
    [{ label: "Check", value: "Send to: 12 Oak St, Austin, TX 78701" }],
  );
  assertEquals(
    payOptionLines({ check: { enabled: true, mailTo: "  " } }, "es", "12 Oak St, Austin, TX 78701"),
    [{ label: "Cheque", value: "Enviar a: 12 Oak St, Austin, TX 78701" }],
  );
  // no address anywhere → the old line is the only honest thing left
  assertEquals(payOptionLines({ check: { enabled: true } }, "en", "  "), [
    { label: "Check", value: "Check accepted" },
  ]);
});

Deno.test("REQ-923 businessAddressLine: street, city, state + ZIP on one line; blanks dropped", () => {
  assertEquals(
    businessAddressLine({ street: "12 Oak St", city: "Austin", state: "TX", postal: "78701" }),
    "12 Oak St, Austin, TX 78701",
  );
  assertEquals(businessAddressLine({ street: "12 Oak St", city: " ", state: "TX" }), "12 Oak St, TX");
  assertEquals(businessAddressLine(null), "");
  assertEquals(businessAddressLine(undefined), "");
});
