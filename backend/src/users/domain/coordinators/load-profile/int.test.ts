import { assertEquals } from "#std/assert";
import { LoadProfile } from "./mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { ContractDefaultsStore } from "@profile/domain/data/contract-defaults-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { BusinessInsuranceStore } from "@profile/domain/data/business-insurance-store/mod.ts";
import { TaxIdentityStore } from "@profile/domain/data/tax-identity-store/mod.ts";
import { ReferenceStore } from "@profile/domain/data/reference-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function freshFlow() {
  const users     = new UserStore();
  const identity  = new BusinessIdentityStore();
  const address   = new BusinessAddressStore();
  const insurance = new BusinessInsuranceStore();
  const tax       = new TaxIdentityStore();
  const defaults  = new ContractDefaultsStore();
  const refs      = new ReferenceStore();
  return {
    users, identity, address, insurance, tax, defaults, refs,
    flow: new LoadProfile(users, identity, address, insurance, tax, defaults, refs),
  };
}

Deno.test("load-profile integration: returns user + null sub-aggregates for fresh signup", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { users, flow } = freshFlow();

  const user = await users.create({ phoneNumber: "+15125551234" });
  const snapshot = await flow.load(user.id);

  assertEquals(snapshot.user.id, user.id);
  assertEquals(snapshot.identity, null);
  assertEquals(snapshot.address, null);
  assertEquals(snapshot.insurance, null);
  assertEquals(snapshot.tax, null);
  assertEquals(snapshot.contractDefaults, null);
  assertEquals(snapshot.references, []);
  assertEquals(snapshot.initials, "?");

  await resetKv();
});

Deno.test("load-profile integration: composite read returns all sub-aggregates after population", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { users, identity, address, insurance, tax, defaults, refs, flow } = freshFlow();

  const user = await users.create({ phoneNumber: "+15125551234" });
  await users.update(user.id, { name: "Diego R." });
  await identity.upsert(user.id,  { businessName: "Riley Roofing Co.", businessLicense: "TX-123" });
  await address.upsert(user.id,    { city: "Austin", state: "TX", postal: "78701" });
  await insurance.upsert(user.id,  { provider: "Hartford", coverageCents: 100_000_000, expiresAt: "2027-01-01" });
  await tax.update(user.id,        { tin: "123-45-6789" });
  await defaults.upsert(user.id,   { warrantyMonths: 12, governingState: "TX", disputeResolution: "mediation" });
  await refs.create(user.id,       { contactName: "Tom K." });

  const snapshot = await flow.load(user.id);

  assertEquals(snapshot.user.name, "Diego R.");
  assertEquals(snapshot.identity?.businessName, "Riley Roofing Co.");
  assertEquals(snapshot.address?.city, "Austin");
  assertEquals(snapshot.insurance?.provider, "Hartford");
  assertEquals(snapshot.tax?.tinMasked, "***-**-6789");
  assertEquals(snapshot.contractDefaults?.warrantyMonths, 12);
  assertEquals(snapshot.references.length, 1);
  assertEquals(snapshot.references[0].contactName, "Tom K.");
  assertEquals(snapshot.initials, "DR");

  // tax projection MUST NOT leak hash/salt
  assertEquals(("tinHashed" in (snapshot.tax ?? {})), false);
  assertEquals(("tinSalt"   in (snapshot.tax ?? {})), false);

  await resetKv();
});

Deno.test("load-profile integration: loadPublic returns safe subset only", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { users, identity, address, insurance, tax, flow } = freshFlow();

  const user = await users.create({ phoneNumber: "+15125551234" });
  await identity.upsert(user.id, { businessName: "Riley", legalName: "Riley LLC", businessLicense: "TX-123" });
  await address.upsert(user.id,   { street: "412 Elm", city: "Austin", state: "TX", postal: "78701" });
  await insurance.upsert(user.id, { provider: "Hartford", policyNumber: "GL-12345", coverageCents: 100_000_000 });
  await tax.update(user.id,       { w9FileId: "file-w9" });

  const pub = await flow.loadPublic(user.id);
  // Identity: businessName + license + logo OK; legalName + userId hidden.
  assertEquals(pub.identity?.businessName, "Riley");
  assertEquals(("legalName" in (pub.identity ?? {})), false);
  // Address: city/state/country only — street + postal hidden.
  assertEquals(pub.address?.city, "Austin");
  assertEquals(pub.address?.state, "TX");
  assertEquals(("street" in (pub.address ?? {})), false);
  assertEquals(("postal" in (pub.address ?? {})), false);
  // Insurance: provider + coverage OK; policyNumber hidden.
  assertEquals(pub.insurance?.provider, "Hartford");
  assertEquals(pub.insurance?.coverageCents, 100_000_000);
  assertEquals(("policyNumber" in (pub.insurance ?? {})), false);
  // Tax: only the boolean presence flag.
  assertEquals(pub.hasW9, true);

  await resetKv();
});

Deno.test("load-profile integration: loadPublic hasW9=false when no w9 uploaded", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { users, flow } = freshFlow();
  const user = await users.create({ phoneNumber: "+15125551234" });
  const pub = await flow.loadPublic(user.id);
  assertEquals(pub.hasW9, false);
  await resetKv();
});

Deno.test("load-profile integration: per-user isolation — one user's data doesn't leak to another", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { users, identity, flow } = freshFlow();

  const a = await users.create({ phoneNumber: "+15125551234" });
  const b = await users.create({ phoneNumber: "+15125559999" });
  await identity.upsert(a.id, { businessName: "Riley Roofing Co." });
  await identity.upsert(b.id, { businessName: "Hernandez Painting" });

  const snapA = await flow.load(a.id);
  const snapB = await flow.load(b.id);
  assertEquals(snapA.identity?.businessName, "Riley Roofing Co.");
  assertEquals(snapB.identity?.businessName, "Hernandez Painting");

  await resetKv();
});
