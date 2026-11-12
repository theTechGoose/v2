import { assertEquals } from "#std/assert";
import { adminSearchMatches, projectAdminUser } from "./mod.ts";
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
    features: {}, // REQ-177
    language: undefined, // REQ-341 — carried when set (the stage reads the presenter's)
  });
});

Deno.test("REQ-341 projectAdminUser: carries the user's language (whoami's impersonator is the presenter)", () => {
  assertEquals(projectAdminUser({ ...base, language: "es" }).language, "es");
  assertEquals(projectAdminUser({ ...base, language: "en" }).language, "en");
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

// REQ-507 (demo-loop cycle 3, m25) — the /admin users search: "abc!!" listed everyone because the
// digit-only needle stripped it to "". A query with no digits matches names / business / email;
// a query with digits also matches the phone; only a blank query lists everyone.
Deno.test("REQ-507 m25 adminSearchMatches: blank lists all; digits match the phone; text matches name, business or email; 'abc!!' matches nobody", () => {
  const deb: User = {
    ...base,
    name: "Deb Kowalski",
    phoneNumber: "+15125550102",
    email: "deb@sparkle.test",
  };
  assertEquals(
    adminSearchMatches(deb, "Sparkle Home Cleaning", ""),
    true,
    "blank",
  );
  assertEquals(
    adminSearchMatches(deb, "Sparkle Home Cleaning", "   "),
    true,
    "whitespace is blank",
  );
  assertEquals(
    adminSearchMatches(deb, undefined, "5125550102"),
    true,
    "full phone",
  );
  assertEquals(
    adminSearchMatches(deb, undefined, "(512) 555"),
    true,
    "formatted partial phone",
  );
  assertEquals(
    adminSearchMatches(deb, undefined, "999"),
    false,
    "other digits",
  );
  assertEquals(
    adminSearchMatches(deb, undefined, "deb"),
    true,
    "name, any case",
  );
  assertEquals(adminSearchMatches(deb, undefined, "kowalski"), true, "surname");
  assertEquals(
    adminSearchMatches(deb, "Sparkle Home Cleaning", "sparkle home"),
    true,
    "business",
  );
  assertEquals(
    adminSearchMatches(deb, undefined, "sparkle.test"),
    true,
    "email",
  );
  assertEquals(
    adminSearchMatches(deb, "Sparkle Home Cleaning", "abc!!"),
    false,
    "abc!! is not everyone",
  );
  assertEquals(
    adminSearchMatches(deb, "Sparkle Home Cleaning", "!!"),
    false,
    "punctuation only is not everyone",
  );
});
