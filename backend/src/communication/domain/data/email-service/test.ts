// REQ-123 — "i do not want to SEND ANYTHING VIA monsterrg.com can we send everything via
// documonster instead?" — the Postmark payload is built by one pure function: no From on the call
// means the house From, a From on documonster.com stands, anything else never reaches Postmark.
// No env var has a say (POSTMARK_FROM is gone: the box's `warnings@monsterrg.com`, main/.env's
// `rafac@monsterrg.com` and prod's `noreply@quotejefe.com` were the three senders until now).
import { assertEquals, assertStringIncludes } from "#std/assert";
import { EmailService, postmarkPayload } from "./mod.ts";
import { HOUSE_FROM } from "@communication/domain/business/sender/mod.ts";

Deno.test("REQ-123 postmarkPayload — a send with no From leaves as DocuMonster <hello@documonster.com>; a From on documonster.com stands", () => {
  const plain = postmarkPayload({ to: "tom@example.test", subject: "Your quote", htmlBody: "<p>see attached</p>" });
  assertEquals(plain.From, HOUSE_FROM);
  assertEquals(plain.To, "tom@example.test");
  assertEquals(plain.Subject, "Your quote");
  assertEquals(plain.HtmlBody, "<p>see attached</p>");
  assertEquals(plain.MessageStream, "outbound");
  assertEquals("Cc" in plain, false);
  assertEquals("Attachments" in plain, false);

  const alias = postmarkPayload({
    to: "tom@example.test",
    subject: "s",
    htmlBody: "h",
    from: "acme-roofing@documonster.com",
    cc: ["me@acme.test", "ops@acme.test"],
    attachments: [{ name: "a.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }],
  });
  assertEquals(alias.From, "acme-roofing@documonster.com");
  assertEquals(alias.Cc, "me@acme.test, ops@acme.test");
  assertEquals(alias.Attachments, [{ Name: "a.pdf", Content: "AQID", ContentType: "application/pdf" }]);
});

Deno.test("REQ-123 EmailService — a From off documonster.com is refused before anything else happens: not in dev mode, not with a key", async () => {
  const svc = new EmailService();
  let calls = 0;
  svc.fetchOverride = (() => {
    calls++;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  for (const from of ["warnings@monsterrg.com", "rafac@monsterrg.com", "noreply@quotejefe.com", "hans-llc@paperworkmonster.com"]) {
    const out = await svc.send({ to: "tom@example.test", subject: "s", htmlBody: "h", from });
    assertEquals(out.ok, false, from);
    assertStringIncludes(out.reason ?? "", from);
    assertStringIncludes(out.reason ?? "", "documonster.com");
  }
  assertEquals(calls, 0, "Postmark is never asked");
});
