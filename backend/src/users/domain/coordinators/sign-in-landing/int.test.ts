/**
 * REQ-091 — "onboarding must happen until we get answers to all the questions."
 *
 * Where a verified code lands: the wizard while any of the nine onboarding
 * questions is open, the dashboard once every one is answered — read off the
 * profile the wizard saves into, never off the one-shot "new user" flag and
 * never off the skip stamp.
 */
import { assertEquals } from "#std/assert";
import { SignInLanding } from "./mod.ts";
import { LoadProfile } from "@profile/domain/coordinators/load-profile/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { ContractDefaultsStore } from "@profile/domain/data/contract-defaults-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { BusinessInsuranceStore } from "@profile/domain/data/business-insurance-store/mod.ts";
import { TaxIdentityStore } from "@profile/domain/data/tax-identity-store/mod.ts";
import { ReferenceStore } from "@profile/domain/data/reference-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { ChoosePlan } from "@users/domain/coordinators/choose-plan/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { PayLinkMint } from "@users/domain/coordinators/pay-link-mint/mod.ts"; // REQ-106
import { SignupNotice } from "@users/domain/coordinators/signup-notice/mod.ts";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { chosen } from "@users/domain/business/plan/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function freshFlow() {
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const address = new BusinessAddressStore();
  const insurance = new BusinessInsuranceStore();
  const plans = new PlanStore();
  const crm = new CrmCustomerSync(users, identity, new PaymentsLink(), plans);
  const profile = new LoadProfile(
    users, identity, address, insurance, new TaxIdentityStore(), new ContractDefaultsStore(), new ReferenceStore(),
    new ChoosePlan(users, plans, new PaymentsLink(), crm, new CrmLeadCapture(new CrmCaptureOutbox(), crm, new SignupNotice(users), new PayLinkMint(new PlanStore(), new PaymentsLink(), crm))), // REQ-099
  );
  return { users, identity, address, insurance, plans, flow: new SignInLanding(profile) };
}

/** every question but `except`, answered the way the wizard saves them */
async function answerAll(f: ReturnType<typeof freshFlow>, userId: string, except: string[] = []) {
  const skip = (q: string) => except.includes(q);
  await f.users.update(userId, {
    ...(skip("name") ? {} : { name: "Story Person" }),
    ...(skip("email") ? {} : { email: "story@example.com" }),
  });
  await f.identity.upsert(userId, {
    ...(skip("businessName") ? {} : { businessName: "Story Roofing LLC" }),
    ...(skip("logo") ? {} : { logoFileId: "f-logo" }),
    ...(skip("payment") ? {} : { acceptedPaymentMethods: { cash: { enabled: true } } }),
  });
  await f.address.upsert(userId, {
    ...(skip("state") ? {} : { state: "TX" }),
    ...(skip("address") ? {} : { street: "1600 Congress Ave" }),
  });
  if (!skip("insurance")) await f.insurance.upsert(userId, { provider: "State Farm" });
  if (!skip("plan")) await f.plans.put(chosen(userId, "free", new Date().toISOString()));
}

Deno.test("REQ-091 sign-in-landing — a fresh account lands in the wizard; the skip stamp changes nothing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = freshFlow();
  const user = await f.users.create({ phoneNumber: "+15125550911", language: "en", name: "New user" });
  assertEquals(await f.flow.run(user.id), "/welcome");
  await f.users.markOnboarded(user.id, true); // "Skip setup for now" used to make this permanent
  assertEquals(await f.flow.run(user.id), "/welcome", "the skip stamp is not an answer");
  await resetKv();
});

Deno.test("REQ-091 sign-in-landing — every question answered lands on the dashboard as a returning user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = freshFlow();
  const user = await f.users.create({ phoneNumber: "+15125550912", language: "en", name: "New user" });
  await answerAll(f, user.id);
  assertEquals(await f.flow.run(user.id), "/dashboard?welcome=back");
  await resetKv();
});

Deno.test("REQ-091 sign-in-landing — one open question, any of the nine, lands in the wizard", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  for (const open of ["name", "businessName", "email", "plan", "state", "address", "payment", "logo", "insurance"]) {
    await resetKv();
    const f = freshFlow();
    const user = await f.users.create({ phoneNumber: "+15125550913", language: "en", name: "New user" });
    await answerAll(f, user.id, [open]);
    assertEquals(await f.flow.run(user.id), "/welcome", `${open} still open`);
  }
  await resetKv();
});

Deno.test("REQ-091 sign-in-landing — a paid pick still waiting on its pay page is an open question", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = freshFlow();
  const user = await f.users.create({ phoneNumber: "+15125550914", language: "en", name: "New user" });
  await answerAll(f, user.id, ["plan"]);
  const now = new Date().toISOString();
  await f.plans.put(chosen(user.id, "monster", now, { customerId: "c-1", dueId: "d-1", payUrl: "https://pay.example/d-1", merchant: "primary" }));
  assertEquals(await f.flow.run(user.id), "/welcome", "pending");
  await resetKv();
});
