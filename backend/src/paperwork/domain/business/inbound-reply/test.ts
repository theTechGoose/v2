import { assertEquals } from "#std/assert";
import { parseInboundReply, replyAddress, replyTokenOf } from "./mod.ts";

// REQ-175 — "when a customers customer replies to an invoice it should go to the customer inbox"
Deno.test("REQ-175 replyAddress / replyTokenOf — reply+<token>@<inbound domain>, read back from any of Postmark's recipient fields", () => {
  assertEquals(
    replyAddress("abc123", "inbound.documonster.com"),
    "reply+abc123@inbound.documonster.com",
  );
  assertEquals(replyTokenOf("reply+abc123@inbound.documonster.com"), "abc123");
  assertEquals(
    replyTokenOf('"A2Z Landscape" <reply+abc123@inbound.documonster.com>'),
    "abc123",
  );
  assertEquals(
    replyTokenOf("rb@acme.test, reply+abc123@inbound.documonster.com"),
    "abc123",
  );
  assertEquals(replyTokenOf("hello@documonster.com"), undefined);
  assertEquals(replyTokenOf(undefined), undefined);
});

Deno.test("REQ-175 parseInboundReply — the token from To / ToFull / OriginalRecipient, the stripped reply over the full text over the html, the sender and subject", () => {
  const r = parseInboundReply({
    From: "rb@acme.test",
    FromName: "Randall Belknap",
    To: "reply+tok1@inbound.documonster.com",
    Subject: "Re: Invoice #4CFC2750",
    TextBody:
      "Looks good, paying Friday.\n\nOn Nov 5, A2Z wrote:\n> Thank you for trusting…",
    StrippedTextReply: "Looks good, paying Friday.",
    MessageID: "pm-1",
  });
  assertEquals(r, {
    token: "tok1",
    from: "rb@acme.test",
    fromName: "Randall Belknap",
    subject: "Re: Invoice #4CFC2750",
    text: "Looks good, paying Friday.",
    messageId: "pm-1",
  });
  // ToFull / OriginalRecipient also carry it; html is the last resort, tags stripped
  assertEquals(
    parseInboundReply({
      ToFull: [{ Email: "reply+tok2@inbound.documonster.com" }],
      HtmlBody: "<p>Can you <b>resend</b>?</p>",
    }).token,
    "tok2",
  );
  assertEquals(
    parseInboundReply({
      OriginalRecipient: "reply+tok3@inbound.documonster.com",
      HtmlBody: "<p>Can you <b>resend</b>?</p>",
    }).text,
    "Can you resend?",
  );
  assertEquals(
    parseInboundReply({ To: "hello@documonster.com", TextBody: "x" }).token,
    undefined,
  );
  assertEquals(parseInboundReply(null).token, undefined);
});
