/**
 * REQ-175 — Postmark's inbound webhook over HTTP: a reply addressed to
 * reply+<token>@… lands in that customer's thread; unknown tokens are refused;
 * the shared secret gates the call when set.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ReplyTokenStore } from "@paperwork/domain/data/reply-token-store/mod.ts";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";

@Module({ imports: [PaperworkModule] })
class TestApp {}
const PORT = 9153;
const J = { "content-type": "application/json" };

Deno.test("REQ-175 POST /inbound/postmark — the reply lands in the customer's thread as an inbound email message; an unknown token is 404; the secret gates the call", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_INBOUND_TOKEN");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const post = async (
    body: unknown,
    qs = "",
    headers: Record<string, string> = {},
  ) => {
    const r = await fetch(`http://localhost:${PORT}/inbound/postmark${qs}`, {
      method: "POST",
      headers: { ...J, ...headers },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const token = await new ReplyTokenStore().forCustomer("u-1", "c-1");
    const reply = {
      From: "rb@acme.test",
      FromName: "Randall Belknap",
      To: `reply+${token}@inbound.documonster.com`,
      Subject: "Re: Invoice #4CFC2750",
      TextBody: "Looks good, paying Friday.\n\nOn Nov 5 A2Z wrote:\n> …",
      StrippedTextReply: "Looks good, paying Friday.",
      MessageID: "pm-1",
    };
    const ok = await post(reply);
    assertEquals(ok.status, 200, JSON.stringify(ok.body));
    assertEquals(ok.body.ok, true);
    const convo = (await new ConversationStore().listByUser("u-1")).find((c) =>
      c.customerId === "c-1"
    );
    assert(convo, "a thread for the customer");
    const msgs = await new MessageStore().listByConversation(convo!.id);
    assertEquals(msgs.length, 1);
    assertEquals([
      msgs[0].role,
      msgs[0].channel,
      msgs[0].fromAddress,
      msgs[0].subject,
    ], ["user", "email", "rb@acme.test", "Re: Invoice #4CFC2750"]);
    assert(
      msgs[0].content.includes("Looks good, paying Friday."),
      msgs[0].content,
    );
    assert(
      !msgs[0].content.includes("On Nov 5"),
      "the quoted history is stripped",
    );
    assert(
      msgs[0].content.includes("Randall Belknap"),
      `the thread says who wrote (${msgs[0].content})`,
    );

    assertEquals(
      (await post({ ...reply, To: "reply+nope00@inbound.documonster.com" }))
        .status,
      404,
    );
    assertEquals(
      (await post({ ...reply, To: "hello@documonster.com" })).status,
      400,
    );

    Deno.env.set("POSTMARK_INBOUND_TOKEN", "s3cret");
    assertEquals((await post(reply)).status, 401);
    assertEquals((await post(reply, "?token=s3cret")).status, 200);
    assertEquals(
      (await post(reply, "", {
        authorization: "Basic " + btoa("postmark:s3cret"),
      })).status,
      200,
    );
  } finally {
    Deno.env.delete("POSTMARK_INBOUND_TOKEN");
    await server.stop();
    await resetKv();
  }
});
