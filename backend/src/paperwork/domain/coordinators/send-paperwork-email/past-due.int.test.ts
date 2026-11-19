/**
 * REQ-1126 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 3, q3-54:
 * an invoice issued already overdue (REQ-962 allows a backdated issue
 * date: issued 2026-10-01, Net 7 → due 2026-10-08) is emailed as "pay
 * whenever you're ready" with "Status Sent", while /invoices says
 * "42d overdue".
 *
 * Through the real path: a backdated sent invoice in KV (:memory:), then
 * SendPaperworkEmail.run; the captured htmlBody must carry no "whenever
 * you're ready" / "cuando quieras", and the standalone email's Status row
 * must read the overdue word, not "Sent" / "Enviada".
 */
import { assert, assertEquals } from "#std/assert";
import { SendPaperworkEmail } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { invoiceStatusLabel } from "#quote-flow/email-format.ts";

const TOTAL = 248_975;
const WHENEVER = { en: "whenever you", es: "cuando quieras" };

async function rig(lang: "en" | "es") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const identities = new BusinessIdentityStore();
  const email = new EmailService();
  const sent: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const flow = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    new UserStore(),
    identities,
    email,
    new LogPaperworkMessage(new CommConversationStore(), new CommMessageStore()),
  );
  const now = new Date().toISOString();
  await (await getKv()).set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  await identities.upsert("u-1", { businessName: "Jensen Electric LLC", commsLanguage: lang });
  const customer = await customers.create("u-1", { name: "Pat Doe", email: "pat@acme.test" });
  return { flow, quotes, invoices, customer, sent };
}

type Rig = Awaited<ReturnType<typeof rig>>;

/** Issued 2026-10-01 on Net 7 → due 2026-10-08, sent today (≥ 2026-11-19). */
async function backdated(r: Rig, quoteLinked: boolean) {
  let quoteId: string | undefined;
  if (quoteLinked) {
    const q = await r.quotes.create("u-1", {
      customerId: r.customer.id,
      summary: "Panel upgrade",
      lineItems: [{ description: "Panel upgrade", quantity: 1, unit: "job", price: TOTAL }],
      estimatedTotal: TOTAL,
    });
    quoteId = q.id;
  }
  return await r.invoices.create("u-1", {
    ...(quoteId ? { quoteId } : { jobName: "Panel upgrade" }),
    customerId: r.customer.id,
    amount: TOTAL,
    status: "sent",
    issuedDate: "2026-10-01",
    dueDate: "2026-10-08",
  } as never);
}

/** The Status / Estado cell of the details table. */
function statusCellOf(html: string, lang: "en" | "es"): string {
  const label = t(lang, "paperworkEmail.invoice.statusLabel");
  const at = html.indexOf(`>${label}<`);
  assert(at >= 0, `the email has a "${label}" row`);
  const m = html.slice(at).match(/<\/td><td[^>]*>([^<]*)<\/td>/);
  assert(m, "the status row has a value cell");
  return m[1].trim();
}

for (const lang of ["en", "es"] as const) {
  for (const quoteLinked of [false, true]) {
    const kind = quoteLinked ? "quote-linked (itemized)" : "standalone (basic)";
    Deno.test(`REQ-1126 (LOOP-007 q3-54) ${kind} ${lang}: SendPaperworkEmail of an invoice issued 2026-10-01 Net 7 never says '${WHENEVER[lang]}'`, async () => {
      const r = await rig(lang);
      try {
        const inv = await backdated(r, quoteLinked);
        const out = await r.flow.run("u-1", { kind: "invoice", resourceId: inv.id, language: lang });
        assert(out.ok, `send failed: ${JSON.stringify(out)}`);
        const html = r.sent[0].htmlBody;
        const hit = html.match(new RegExp(`[^<>]{0,80}${WHENEVER[lang]}[^<>]{0,40}`));
        assert(!hit, `the past-due ${lang} email says: ${hit?.[0].trim()}`);
      } finally {
        await resetKv();
      }
    });
  }

  Deno.test(`REQ-1126 (LOOP-007 q3-54) standalone ${lang}: SendPaperworkEmail of an invoice due 2026-10-08 shows the overdue Status, not Sent`, async () => {
    const r = await rig(lang);
    try {
      const inv = await backdated(r, false);
      const out = await r.flow.run("u-1", { kind: "invoice", resourceId: inv.id, language: lang });
      assert(out.ok, `send failed: ${JSON.stringify(out)}`);
      assertEquals(statusCellOf(r.sent[0].htmlBody, lang), invoiceStatusLabel("overdue", lang));
    } finally {
      await resetKv();
    }
  });
}
