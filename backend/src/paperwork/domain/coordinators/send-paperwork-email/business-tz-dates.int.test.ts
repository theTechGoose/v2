/**
 * REQ-944 (LOOP-007 cycle 1, q1-10) — documents sent in the evening carried
 * the next day's date. An Austin, TX business (Central, zone auto-set) sent
 * Q-001 at 7:37 PM on Wed Nov 18; the email the customer got read
 * "Creada 19 de noviembre de 2026": `fmtDate(q.createdAt, lang)` passes no
 * time zone, so the date follows the server process's zone (UTC on Deno
 * Deploy), never the business's.
 *
 * Integration: the real SendPaperworkEmail and stores on an in-memory KV;
 * only the email provider is captured. The quote's createdAt is pinned to
 * 2026-11-19T05:37Z — 11:37 PM Central on Nov 18, Nov 19 in UTC and in New
 * York, so it is red on either kind of host.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendPaperworkEmail } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@users/domain/data/business-address-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

const USER = "u-req944";
const LATE_EVENING = "2026-11-19T05:37:00.000Z";

Deno.test("REQ-944 q1-10: a TX business's quote email sent at 11:37 PM Central on Nov 18 reads 'Creada 18 de noviembre de 2026', not the UTC day", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const quotes = new QuoteStore();
    const customers = new CustomerStore();
    const identities = new BusinessIdentityStore();
    const email = new EmailService();
    const sent: SendEmailInput[] = [];
    email.send = (input: SendEmailInput) => {
      sent.push(input);
      return Promise.resolve({ ok: true, reason: "test_capture" });
    };
    const flow = new SendPaperworkEmail(
      quotes,
      new InvoiceStore(),
      customers,
      new UserStore(),
      identities,
      email,
      new LogPaperworkMessage(
        new CommConversationStore(),
        new CommMessageStore(),
      ),
    );
    const kv = await getKv();
    await kv.set(["user", USER], {
      id: USER,
      phoneNumber: "+15125550944",
      name: "Rosa Garza",
      email: "rosa@test.dev",
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    });
    // Austin, TX — the zone Settings shows (auto-set from the state)
    await identities.upsert(USER, {
      businessName: "Garza Roofing",
      commsLanguage: "es",
      timezone: "America/Chicago",
    });
    await new BusinessAddressStore().upsert(USER, {
      street: "100 Congress Ave",
      city: "Austin",
      state: "TX",
    });
    const customer = await customers.create(USER, {
      name: "Ana Torres",
      email: "ana@acme.test",
    });
    const made = await quotes.create(USER, {
      customerId: customer.id,
      summary: "Reparación de techo",
      lineItems: [
        { description: "Tejas", quantity: 1, unit: "ea", price: 900_00 },
        { description: "Mano de obra", quantity: 1, unit: "ea", price: 300_00 },
      ],
      estimatedTotal: 1_200_00,
    });
    const row = (await kv.get<Record<string, unknown>>(["quote", made.id]))
      .value!;
    await kv.set(["quote", made.id], { ...row, createdAt: LATE_EVENING });

    const r = await flow.run(USER, { kind: "quote", resourceId: made.id });
    assertEquals(r.ok, true, r.reason);
    assertEquals(sent.length, 1);
    const html = sent[0].htmlBody;
    assertStringIncludes(html, "Creada");
    assertStringIncludes(html, "18 de noviembre de 2026");
    assert(
      !html.includes("19 de noviembre de 2026"),
      `the email prints the UTC day: …${
        html.slice(
          Math.max(0, html.indexOf("19 de noviembre de 2026") - 120),
          html.indexOf("19 de noviembre de 2026") + 30,
        )
      }…`,
    );
  } finally {
    await resetKv();
  }
});
