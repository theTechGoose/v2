import { assertEquals } from "#std/assert";
import { projectPublicBusinessIdentity } from "./mod.ts";
import type { BusinessIdentity } from "@profile/dto/business-identity.ts";

const source: BusinessIdentity = {
  userId: "u-1",
  businessName: "Riley Roofing Co.",
  legalName: "Riley Roofing & Sons LLC",
  businessLicense: "TX-123456",
  logoFileId: "file-abc",
  createdAt: "2026-04-26T00:00:00.000Z",
  updatedAt: "2026-04-26T00:00:00.000Z",
};

Deno.test("projectPublicBusinessIdentity: omits userId, legalName, timestamps", () => {
  const out = projectPublicBusinessIdentity(source);
  assertEquals(out, {
    businessName: "Riley Roofing Co.",
    businessLicense: "TX-123456",
    logoFileId: "file-abc",
  });
});

Deno.test("projectPublicBusinessIdentity: returns null for null input", () => {
  assertEquals(projectPublicBusinessIdentity(null), null);
});

Deno.test("projectPublicBusinessIdentity: leaves optional fields undefined when absent", () => {
  const minimal: BusinessIdentity = {
    userId: "u-2",
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
  assertEquals(projectPublicBusinessIdentity(minimal), {
    businessName: undefined,
    businessLicense: undefined,
    logoFileId: undefined,
  });
});
