import { assertEquals } from "#std/assert";
import { projectAdminUser } from "./mod.ts";
import type { User } from "@users/dto/user.ts";

const base: User = {
  id: "u-1",
  phoneNumber: "+15125551234",
  name: "Diego Ramirez",
  createdAt: "2026-04-26T00:00:00.000Z",
  updatedAt: "2026-04-26T00:00:00.000Z",
};

Deno.test("projectAdminUser: maps the fixed admin shape + businessName", () => {
  const out = projectAdminUser(base, "Ramirez Roofing");
  assertEquals(out, {
    id: "u-1",
    name: "Diego Ramirez",
    phoneNumber: "+15125551234",
    businessName: "Ramirez Roofing",
    superAdmin: false,
  });
});

Deno.test("projectAdminUser: coerces superAdmin to a real boolean", () => {
  assertEquals(
    projectAdminUser({ ...base, superAdmin: true }).superAdmin,
    true,
  );
  assertEquals(projectAdminUser(base).superAdmin, false);
});

Deno.test("projectAdminUser: null/absent businessName → undefined", () => {
  assertEquals(projectAdminUser(base, null).businessName, undefined);
  assertEquals(projectAdminUser(base).businessName, undefined);
});
