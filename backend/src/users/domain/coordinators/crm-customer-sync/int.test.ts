// REQ-058 — the account is a CRM customer from sign-up, and onboarding fills that record in: on
// the fakes (the KV stores and the fake link builder, which upserts by ref like the CRM does).
import { assertEquals, assertRejects } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { fakePaymentsWorld, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { placeholderNameFor } from "@users/domain/business/placeholder-name/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { BusinessAddressStore } from "@users/domain/data/business-address-store/mod.ts";
import { CrmCustomerSync, customerFor, LEAD_SOURCE } from "./mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("PPWK_PAYMENTS_URL");
  Deno.env.delete("PPWK_PAYMENTS_TOKEN");
  Deno.env.delete("PPWK_PAYMENTS_ACCOUNT");
  await resetKv();
  fakePaymentsWorld().reset();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const link = new PaymentsLink();
  const plans = new PlanStore();
  const address = new BusinessAddressStore();
  return { users, identity, link, plans, address, sync: new CrmCustomerSync(users, identity, link, plans, address) };
}

// REQ-070 — what onboarding knows rides to the CRM's lead columns (its REQ-098)
Deno.test("REQ-070 crm-customer-sync — the person, the business's city and state, its website and this app's name ride with every sync; a lead has only the source", async () => {
  const { users, identity, address, sync } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550270", language: "es", name: placeholderNameFor("es") });
  await sync.ensure(user.id);
  const lead = fakePaymentsWorld().customers[0];
  assertEquals([lead.contact, lead.city, lead.state, lead.website, lead.leadSource], [undefined, undefined, undefined, undefined, LEAD_SOURCE], "a placeholder is never the contact");
  await users.update(user.id, { name: "María Ejemplo", email: "maria@pintura.test" });
  await identity.upsert(user.id, { businessName: "Pintura Ejemplo LLC", websiteUrl: "https://pintura-ejemplo.test" });
  await address.upsert(user.id, { street: "456 Oak Ave", city: "Dallas", state: "tx", postal: "75201" });
  await sync.ensure(user.id);
  const filled = fakePaymentsWorld().customers[0];
  assertEquals([filled.customerName, filled.contact, filled.city, filled.state, filled.website, filled.leadSource], ["Pintura Ejemplo LLC", "María Ejemplo", "Dallas", "TX", "https://pintura-ejemplo.test", LEAD_SOURCE]);
  assertEquals(fakePaymentsWorld().customers.length, 1, "the same record");
});

Deno.test("REQ-070 customerFor — pure: blanks are left out so the CRM keeps what it has; the state is upper-cased", () => {
  const user = { id: "u-70", name: "Ana", email: "a@b.test", phoneNumber: "+15125550271" } as unknown as Parameters<typeof customerFor>[0];
  const c = customerFor(user, { businessName: "Ana Roofing", websiteUrl: "  " }, null, { city: " Austin ", state: "tx" });
  assertEquals([c.contact, c.city, c.state, "website" in c, c.leadSource], ["Ana", "Austin", "TX", false, LEAD_SOURCE]);
  const bare = customerFor(user, null, null, null);
  assertEquals(["city" in bare, "state" in bare, bare.contact], [false, false, "Ana"]);
});

Deno.test("REQ-058 crm-customer-sync — a sign-up makes the customer with what there is: no name yet (REQ-062: 'unknown dragon mcdragonson'), the phone, no email, this app's ref", async () => {
  const { users, sync } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550201", language: "en", name: placeholderNameFor("en") });
  assertEquals(await sync.read(user.id), null, "nothing on the CRM before the first sync");
  const made = await sync.ensure(user.id);
  const world = fakePaymentsWorld();
  assertEquals(world.customers.length, 1);
  const { createdAt, ...born } = world.customers[0];
  assertEquals(typeof createdAt, "string");
  assertEquals(born, {
    customerId: made!.customerId,
    customerName: "unknown dragon mcdragonson",
    leadSource: LEAD_SOURCE, // REQ-070 — a lead says where it came from, nothing else
    customerEmail: "",
    customerPhone: "+15125550201",
    externalRef: `pm:${user.id}`,
    tier: "Lead",
  });
  assertEquals((await sync.read(user.id))?.customerId, made!.customerId);
});

Deno.test("REQ-058 crm-customer-sync — onboarding fills the SAME customer in: the business as its name, the account's email; never a second record", async () => {
  const { users, identity, sync } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550202", language: "es", name: placeholderNameFor("es") });
  const made = await sync.ensure(user.id);
  await users.update(user.id, { name: "Ana", email: "ana@roof.test" });
  await sync.ensure(user.id);
  assertEquals(fakePaymentsWorld().customers.map((c) => [c.customerId, c.customerName, c.customerEmail]), [[made!.customerId, "Ana", "ana@roof.test"]]);
  await identity.upsert(user.id, { businessName: "Ana Roofing" });
  await sync.ensure(user.id);
  assertEquals(fakePaymentsWorld().customers.map((c) => [c.customerId, c.customerName, c.customerEmail, c.customerPhone]), [[made!.customerId, "Ana Roofing", "ana@roof.test", "+15125550202"]]);
  assertEquals((await sync.read(user.id))?.customerName, "Ana Roofing");
});

Deno.test("REQ-058/099 crm-customer-sync — the CRM being down is thrown by ensure, named: the sweep that carries every sync (REQ-098/099) defers it and nothing on the account fails", async () => {
  const { users, link, sync } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550203" });
  Deno.env.set("PPWK_PAYMENTS_URL", "http://crm.test");
  Deno.env.set("PPWK_PAYMENTS_TOKEN", "t");
  Deno.env.set("PPWK_PAYMENTS_ACCOUNT", "primary"); // REQ-069
  link.fetchOverride = () => Promise.reject(new TypeError("connection refused"));
  try {
    await assertRejects(() => sync.ensure(user.id), Error, "payments-unavailable");
  } finally {
    Deno.env.delete("PPWK_PAYMENTS_URL");
    Deno.env.delete("PPWK_PAYMENTS_TOKEN");
    Deno.env.delete("PPWK_PAYMENTS_ACCOUNT");
  }
});

Deno.test("REQ-060 crm-customer-sync — the phone typed into login is a CRM lead at once; the sign-up with it claims that lead; the lead never overwrites the account", async () => {
  const { users, sync } = await fresh();
  const captured = await sync.capture("(512) 555-0199");
  const world = fakePaymentsWorld();
  assertEquals(world.customers.length, 1);
  assertEquals([world.customers[0].customerName, world.customers[0].customerPhone, world.customers[0].customerEmail, world.customers[0].externalRef, world.customers[0].tier], ["unknown dragon mcdragonson", "+15125550199", "", undefined, "Lead"]);
  assertEquals(captured?.customerId, world.customers[0].customerId);
  // no code entered, no onboarding — the lead stands. Later the same phone signs up:
  const user = await users.create({ phoneNumber: "+15125550199", language: "en", name: placeholderNameFor("en") });
  const made = await sync.ensure(user.id);
  assertEquals(made?.customerId, captured?.customerId, "the account IS the lead");
  assertEquals(world.customers.length, 1);
  assertEquals((await sync.read(user.id))?.externalRef, `pm:${user.id}`);
  // onboarding fills the name in; a second lead capture for the same phone (a re-login) changes nothing
  await users.update(user.id, { name: "Rosa Demo" });
  await sync.ensure(user.id);
  await sync.capture("+15125550199");
  assertEquals((await sync.read(user.id))?.customerName, "Rosa Demo");
  assertEquals(world.customers.length, 1);
});

// REQ-062 — "sign up free, close the browser before finishing sign up: customer phone number in
// quickbase as 'unknown dragon mcdragonson'" … "sign up paid … guest info updated in quickbase with tier"
Deno.test("REQ-062 crm-customer-sync — the lead and the half-finished account are 'unknown dragon mcdragonson', tier Lead; the tier follows the plan once it is paid, and comes back to Lead on free", async () => {
  const { users, plans, sync } = await fresh();
  await sync.capture("+15125550777");
  const world = fakePaymentsWorld();
  assertEquals([world.customers[0].customerName, world.customers[0].tier], ["unknown dragon mcdragonson", "Lead"]);
  const user = await users.create({ phoneNumber: "+15125550777", language: "es", name: placeholderNameFor("es") });
  await sync.ensure(user.id);
  let crm = await sync.read(user.id);
  assertEquals([crm?.customerName, crm?.tier, crm?.customerPhone], ["unknown dragon mcdragonson", "Lead", "+15125550777"], "the placeholder is not a name");
  const now = new Date().toISOString();
  await plans.put({ userId: user.id, planId: "monster", status: "pending", chosenAt: now, updatedAt: now });
  await sync.ensure(user.id);
  assertEquals((await sync.read(user.id))?.tier, "Lead", "not paid yet");
  await plans.put({ userId: user.id, planId: "monster", status: "active", chosenAt: now, activatedAt: now, updatedAt: now });
  await users.update(user.id, { name: "Rosa Demo" });
  await sync.ensure(user.id);
  crm = await sync.read(user.id);
  assertEquals([crm?.customerName, crm?.tier], ["Rosa Demo", "Monster"]);
  await plans.put({ userId: user.id, planId: "free", status: "free", chosenAt: now, updatedAt: now });
  await sync.ensure(user.id);
  assertEquals((await sync.read(user.id))?.tier, "Lead");
  assertEquals(world.customers.length, 1, "one record throughout");
});
