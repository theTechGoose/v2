/**
 * REQ-965 — LOOP-007 cycle 1, issue q1-43 ("Contractor phone unformatted or
 * inconsistent in emails"): the signed-agreement email's From block showed
 * "Marcus Reyes +15125550701". It shows the phone the way Settings and the
 * public quote do: "(512) 555-0701". (A tel: link may keep the E.164.)
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendSignedConfirmation } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

/** The text a reader sees: tags and attribute values (href="tel:…") dropped. */
const visibleText = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

Deno.test("REQ-965 (q1-43) signed-agreement email: the From block shows the contractor's '+15125550701' as '(512) 555-0701'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    const kv = await getKv();
    const now = new Date().toISOString();
    await kv.set(["user", "u-1"], {
      id: "u-1",
      phoneNumber: "+15125550701",
      name: "Marcus Reyes",
      email: "marcus@test.dev",
      language: "en",
      createdAt: now,
      updatedAt: now,
    });
    const quotes = new QuoteStore();
    const customers = new CustomerStore();
    const email = new EmailService();
    const sent: SendEmailInput[] = [];
    email.send = (input: SendEmailInput) => {
      sent.push(input);
      return Promise.resolve({ ok: true, reason: "test_capture" });
    };
    const flow = new SendSignedConfirmation(
      quotes,
      new InvoiceStore(),
      customers,
      new UserStore(),
      new BusinessIdentityStore(),
      new RenderQuotePdf(),
      email,
      new SmsService(),
      new LogPaperworkMessage(new CommConversationStore(), new CommMessageStore()),
    );
    const customer = await customers.create("u-1", {
      name: "Dana Pruitt",
      email: "dana@example.com",
    });
    const quote = await quotes.create("u-1", {
      customerId: customer.id,
      summary: "Roof repair",
      lineItems: [],
      estimatedTotal: 500_00,
      status: "accepted",
      acceptedAt: now,
      acceptedName: "Dana Pruitt",
    });
    const result = await flow.run(quote.id);
    assertEquals(result.ok, true);
    assertEquals(sent.length, 1);
    const text = visibleText(sent[0].htmlBody);
    assertStringIncludes(text, "Marcus Reyes", "the From block");
    assertStringIncludes(text, "(512) 555-0701", "the contractor's phone, formatted");
    assert(!text.includes("+15125550701"), `no raw E.164 phone in the visible text: ${text}`);
    assert(!text.includes("+1 (512)"), `not the second '+1 (…)' format: ${text}`);
  } finally {
    await resetKv();
  }
});
