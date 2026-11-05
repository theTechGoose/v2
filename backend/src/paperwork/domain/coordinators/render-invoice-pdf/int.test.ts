import { assert, assertEquals } from "#std/assert";
import { RenderInvoicePdf } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

async function seedContractor(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Alexander Jerez",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
}

// REQ-161 — "download pdf gives 500." — prod answered
// {"status":500,"message":"WinAnsi cannot encode \"→\" (0x2192)"} for every batch invoice
Deno.test("REQ-161 render-invoice-pdf: a batch invoice titled 'Maintenance 2026-10-01 → 2026-10-31' (and lines with emoji) renders a PDF instead of throwing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await seedContractor("u-1");
  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC" });
  const customer = await customers.create("u-1", {
    name: "Randall Belknap",
    email: "rb@acme.test",
  });
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "draft",
    jobName: "Maintenance 2026-10-01 → 2026-10-31",
    description: "Oct 2 — Lawn — 725 Frederick Rd ✅",
    lineItems: [{
      description: "Oct 2 — Lawn — 725 Frederick Rd ✅",
      quantity: 1,
      unit: "visit",
      price: 6500,
    }],
    amount: 6500,
  });
  const render = new RenderInvoicePdf(
    invoices,
    new QuoteStore(),
    customers,
    new UserStore(),
    identities,
  );
  const bytes = await render.run(inv.id);
  assert(bytes.length > 1000, `a real PDF (${bytes.length} bytes)`);
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  await resetKv();
});
