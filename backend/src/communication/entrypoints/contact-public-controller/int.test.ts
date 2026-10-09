/**
 * REQ-068 — Hans's contact-page example: the inquiry form carries a phone and
 * an SMS consent box. The consent has to be on record with the inquiry, so the
 * email the team receives prints both. This boots the communication module
 * against a stand-in Postmark (a local server capturing the payload) and reads
 * the email that POST /contact dispatches.
 */
import "#reflect-metadata";
import { assertEquals, assertMatch, assertNotMatch } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CommunicationModule } from "@communication/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [CommunicationModule] })
class TestApp {}

const PORT = 9041;
const POSTMARK_PORT = 9042;

Deno.test("REQ-068 contact int — the inquiry email carries the phone and the SMS consent, and a form without them still sends", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.set("POSTMARK_FROM", "ops@example.test");
  Deno.env.set("POSTMARK_API_KEY", "test-token");
  Deno.env.set("POSTMARK_BASE_URL", `http://localhost:${POSTMARK_PORT}`);
  await resetKv();

  const sent: Array<{ To: string; Subject: string; HtmlBody: string }> = [];
  const postmark = Deno.serve(
    { port: POSTMARK_PORT, onListen() {} },
    async (req) => {
      sent.push(await req.json());
      return Response.json({ MessageID: `m-${sent.length}` });
    },
  );
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const post = (body: Record<string, unknown>) =>
      fetch(`http://localhost:${PORT}/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    // a consented inquiry: the phone and "yes" are in the email
    const consented = await post({
      name: "Hans Pedersen",
      email: "consent@example.test",
      phone: "540-333-1334",
      subject: "Texting",
      message: "Please text me about the quote.",
      smsConsent: true,
    });
    assertEquals(consented.ok, true);
    assertEquals(sent.length, 1);
    assertEquals(sent[0].Subject, "[contact] Texting");
    assertMatch(sent[0].HtmlBody, /Phone:<\/strong> 540-333-1334/);
    assertMatch(sent[0].HtmlBody, /SMS consent:<\/strong> yes/);

    // a phone given without ticking the box: on record as "no"
    const declined = await post({
      name: "No Texts",
      email: "declined@example.test",
      phone: "+1 (540) 555-0100",
      subject: "Email only",
      message: "Do not text me.",
      smsConsent: false,
    });
    assertEquals(declined.ok, true);
    assertEquals(sent.length, 2);
    assertMatch(sent[1].HtmlBody, /Phone:<\/strong> \+1 \(540\) 555-0100/);
    assertMatch(sent[1].HtmlBody, /SMS consent:<\/strong> no/);

    // the form as it was — neither field — still goes through, and says so
    const plain = await post({
      name: "Lead",
      email: "lead@example.test",
      subject: "Need a quote",
      message: "Roof replacement.",
    });
    assertEquals(plain.ok, true);
    assertEquals(sent.length, 3);
    assertNotMatch(sent[2].HtmlBody, /Phone:/);
    assertMatch(sent[2].HtmlBody, /SMS consent:<\/strong> no/);
  } finally {
    await server.stop();
    await postmark.shutdown();
    await resetKv();
    Deno.env.delete("POSTMARK_API_KEY");
    Deno.env.delete("POSTMARK_BASE_URL");
  }
});
