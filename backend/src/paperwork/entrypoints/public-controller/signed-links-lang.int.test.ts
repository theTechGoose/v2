/**
 * REQ-1050 (LOOP-007 cycle 2, issue q2-36; amends REQ-342) — signed through
 * the real POST /quotes/:id/accept, the English customer's signed-copy email
 * (as the outbox records it) links to /i/<invoiceId>?lang=en and
 * /q/<quoteId>?lang=en. (The signed text's /q link is covered by the
 * coordinator test send-lang-links.test.ts: with no Twilio sender here the
 * outbox keeps no body for an unsent text.)
 *
 * QA2's email 005 "Pay the first invoice →" linked to a bare /i/<id>, so a
 * browser holding pm_lang=es (from a Spanish quote it had opened) showed
 * "Factura" / "PENDIENTE" for an English job. REQ-342: every link a customer
 * receives carries ?lang=<send language>.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { OutboxStore } from "@communication/domain/data/outbox-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone = "+15125571050"): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

/** the path+query of every link in `text` to /<kind>/<id> */
function linksTo(text: string, kind: "i" | "q", id: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)]
    .map((m) => new URL(m[0].replaceAll("&amp;", "&").replace(/[.,)]+$/, "")))
    .filter((u) => u.pathname === `/${kind}/${id}`)
    .map((u) => u.pathname + u.search);
}

Deno.test("REQ-1050 (LOOP-007 q2-36, REQ-342): an English quote signed through POST /quotes/:id/accept — the outbox's signed-copy email links to /i/<invoiceId>?lang=en and /q/<quoteId>?lang=en", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    // the account sends in both languages (QA's had a Spanish Q-002 too)
    await new BusinessIdentityStore().upsert(owner.userId, {
      businessName: "Park Decks",
      commsLanguage: "en",
      commsLanguages: ["en", "es"],
    } as never);
    const customer = await new CustomerStore().create(owner.userId, {
      name: "Linda Park",
      email: "linda@blackhole.postmarkapp.com",
      phoneNumber: "(512) 555-1234",
      language: "en",
    });
    const q = await new QuoteStore().create(owner.userId, {
      summary: "Deck repair",
      customerId: customer.id,
      lineItems: [{
        description: "Deck repair",
        quantity: 1,
        unit: "job",
        price: 200_000,
      }],
      estimatedTotal: 200_000,
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50/50",
      }],
    } as never);
    await new QuoteStore().update(q.id, owner.userId, { status: "sent" });

    const acc = await fetch(`${base()}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Linda Park" }),
    });
    assertEquals(acc.status, 200, await acc.text());

    const first = (await new InvoiceStore().listByUser(owner.userId))
      .filter((i) => i.quoteId === q.id)
      .sort((a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0))[0];
    assert(first, "signing billed the first milestone");

    const outbox = new OutboxStore();
    const rows = (await outbox.listByUser(owner.userId))
      .filter((r) => r.kind === "signedCopy");
    const mailRow = rows.find((r) => r.channel === "email");
    assert(
      mailRow,
      `the signed copy email is in the outbox: ${JSON.stringify(rows)}`,
    );
    assertEquals(mailRow.language, "en", "the signed copy went out in English");

    const html = (await outbox.getOwned(mailRow.id, owner.userId)).body ?? "";
    assert(html.includes('<html lang="en"'), "the email is English");

    assertEquals(
      {
        emailInvoice: linksTo(html, "i", first.id),
        emailAgreement: linksTo(html, "q", q.id),
      },
      {
        emailInvoice: [`/i/${first.id}?lang=en`],
        emailAgreement: [`/q/${q.id}?lang=en`],
      },
      "every customer link in the signed confirmation email carries ?lang=en",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
