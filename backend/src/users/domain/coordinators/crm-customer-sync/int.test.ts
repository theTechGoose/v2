// REQ-058 — the account is a CRM customer from sign-up, and onboarding fills that record in: on
// the fakes (the KV stores and the fake link builder, which upserts by ref like the CRM does).
import { assertEquals } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { fakePaymentsWorld, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { placeholderNameFor } from "@users/domain/business/placeholder-name/mod.ts";
import { CrmCustomerSync } from "./mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("PPWK_PAYMENTS_URL");
  Deno.env.delete("PPWK_PAYMENTS_TOKEN");
  await resetKv();
  fakePaymentsWorld().reset();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const link = new PaymentsLink();
  return { users, identity, link, sync: new CrmCustomerSync(users, identity, link) };
}

Deno.test("REQ-058 crm-customer-sync — a sign-up makes the customer with what there is: the phone as its name, no email, this app's ref", async () => {
  const { users, sync } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550201", language: "en", name: placeholderNameFor("en") });
  assertEquals(await sync.read(user.id), null, "nothing on the CRM before the first sync");
  const made = await sync.sync(user.id);
  const world = fakePaymentsWorld();
  assertEquals(world.customers.length, 1);
  assertEquals(world.customers[0], {
    customerId: made!.customerId,
    customerName: "+15125550201",
    customerEmail: "",
    customerPhone: "+15125550201",
    externalRef: `pm:${user.id}`,
  });
  assertEquals((await sync.read(user.id))?.customerId, made!.customerId);
});

Deno.test("REQ-058 crm-customer-sync — onboarding fills the SAME customer in: the business as its name, the account's email; never a second record", async () => {
  const { users, identity, sync } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550202", language: "es", name: placeholderNameFor("es") });
  const made = await sync.sync(user.id);
  await users.update(user.id, { name: "Ana", email: "ana@roof.test" });
  await sync.sync(user.id);
  assertEquals(fakePaymentsWorld().customers.map((c) => [c.customerId, c.customerName, c.customerEmail]), [[made!.customerId, "Ana", "ana@roof.test"]]);
  await identity.upsert(user.id, { businessName: "Ana Roofing" });
  await sync.sync(user.id);
  assertEquals(fakePaymentsWorld().customers.map((c) => [c.customerId, c.customerName, c.customerEmail, c.customerPhone]), [[made!.customerId, "Ana Roofing", "ana@roof.test", "+15125550202"]]);
  assertEquals((await sync.read(user.id))?.customerName, "Ana Roofing");
});

Deno.test("REQ-058 crm-customer-sync — the CRM being down never fails the account's write: sync answers null and says so", async () => {
  const { users, link, sync } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550203" });
  Deno.env.set("PPWK_PAYMENTS_URL", "http://crm.test");
  Deno.env.set("PPWK_PAYMENTS_TOKEN", "t");
  link.fetchOverride = () => Promise.reject(new TypeError("connection refused"));
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => warned.push(a.join(" "));
  try {
    assertEquals(await sync.sync(user.id), null);
  } finally {
    console.warn = warn;
    Deno.env.delete("PPWK_PAYMENTS_URL");
    Deno.env.delete("PPWK_PAYMENTS_TOKEN");
  }
  assertEquals(warned.length, 1);
  assertEquals(warned[0].includes("payments-unavailable"), true, warned[0]);
});
