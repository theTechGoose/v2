/**
 * REQ-770 (demo-loop cycle 5v5, issue m12 re-test; follows REQ-681 / REQ-764)
 * — a change order made in chat for a customer whose phone can't take texts
 * (the reserved 555 block) never offers to "email and text it".
 *
 * The verifier, on merged demo-fixes: Maria Lopez's cell is (512) 555-0188;
 * "add a change order …" answered "Change order CO-001 added … It has not
 * been sent to Maria Lopez yet — tap Send CO-001 to email and text it …",
 * though sending it skips the text (REQ-681) and the send dialog already says
 * the number can't receive texts. The offer must say it will be emailed and
 * why it won't be texted.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { ApplyChatChangeOrder } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const changeOrders = new ChangeOrderStore();
  const customers = new CustomerStore();
  const alerted: string[] = [];
  const alert = {
    run: (id: string) => {
      alerted.push(id);
      return Promise.resolve({ ok: true });
    },
  } as unknown as SendChangeOrderAlert;
  const flow = new ApplyChatChangeOrder(
    quotes,
    invoices,
    changeOrders,
    customers,
    alert,
  );
  return { quotes, invoices, customers, alerted, flow };
}

/** Maria's job: Q-001 signed, INV-001 open (sent), her cell a 555 number. */
async function mariaJob(
  f: Awaited<ReturnType<typeof fresh>>,
  phoneNumber: string,
) {
  const maria = await f.customers.create("u-1", {
    name: "Maria Lopez",
    email: "maria@example.com",
    phoneNumber,
  });
  const now = new Date().toISOString();
  const draft = await f.quotes.create("u-1", {
    summary: "Fence painting — Maria Lopez",
    jobName: "Fence painting",
    customerId: maria.id,
    lineItems: [{
      description: "Fence painting",
      quantity: 1,
      unit: "job",
      price: 80_000,
    }],
    estimatedTotal: 80_000,
  });
  const quote = await f.quotes.update(draft.id, "u-1", {
    status: "accepted",
    sentAt: now,
    acceptedAt: now,
  });
  await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: maria.id,
    amount: 80_000,
    status: "sent",
    sentAt: now,
  } as never);
  return { maria, quote };
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-770 m12 (cycle 5v5): the change-order offer for a (512) 555-0188 cell never says 'email and text it' — it says email, and why no text (${lang})`, async () => {
    const f = await fresh();
    const { quote } = await mariaJob(f, "(512) 555-0188");
    const res = await f.flow.run({
      userId: "u-1",
      lang,
      boundQuoteId: quote.id,
      description: "Second coat on the gate",
      deltaAmountCents: 15_000,
      userText: "add a change order: second coat on the gate, $150",
    });
    const dict = JSON.parse(
      Deno.readTextFileSync(
        new URL(`../../../../../../lang/${lang}.json`, import.meta.url),
      ),
    );
    assertEquals(f.alerted, [], `nothing should be sent yet — ${res.text}`);
    assertStringIncludes(res.text, "CO-001");
    assert(
      !/email and text it|correo y mensaje de texto/i.test(
        res.text,
      ),
      `the offer still promises a text: ${res.text}`,
    );
    assertStringIncludes(res.text, dict["sms.fictionalNumber"]);
  });
}

Deno.test("REQ-770 m12 (cycle 5v5): a textable cell keeps the 'email and text it' offer", async () => {
  const f = await fresh();
  const { quote } = await mariaJob(f, "(512) 867-5309");
  const res = await f.flow.run({
    userId: "u-1",
    lang: "en",
    boundQuoteId: quote.id,
    description: "Second coat on the gate",
    deltaAmountCents: 15_000,
    userText: "add a change order: second coat on the gate, $150",
  });
  assertStringIncludes(res.text, "tap Send CO-001 to email and text it");
});
