import { assert, assertEquals } from "@std/assert";
import { adminGateFor } from "./admin-gate.ts";
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };

/**
 * REQ-376 (demo-loop cycle 2, issues m20 + nc-second-demo) — while a demo runs the staff browser IS
 * the customer (impersonation swaps the session cookie), so a second /admin tab was bounced to the
 * customer's /dashboard with no word. `adminGateFor` reads the session's whoami + /demo-mode/active
 * and says what the /admin interstitial shows: whom this browser is guiding, in the presenter's
 * language, and the demo to go back to (null when the impersonation is not a demo).
 */
const customer = {
  id: "c1",
  name: "Ana Torres",
  phoneNumber: "+15125550101",
  businessName: "Torres Roofing",
  superAdmin: false,
  language: "es" as const,
};
const staff = {
  id: "s1",
  name: "Hans",
  phoneNumber: "+18435550101",
  superAdmin: true,
  language: "en" as const,
};
const impersonating = {
  authenticated: true,
  user: customer,
  superAdmin: false,
  impersonating: true,
  impersonator: staff,
};
const presenting = {
  role: "presenter" as const,
  session: {
    id: "demo_1",
    presenterName: "Hans",
    targetName: "Ana Torres",
    targetUserId: "c1",
    presenters: [{ userId: "s1", name: "Hans", color: "#2f6d29" }],
  },
  targetPath: null,
  pid: "p1",
};

Deno.test("REQ-376 adminGateFor — an impersonating session presenting a demo: the customer's name, the demo to go back to, the presenter's language", () => {
  assertEquals(adminGateFor(impersonating, presenting), {
    customer: "Ana Torres",
    demoId: "demo_1",
    presenters: 1,
    lang: "en",
  });
});

Deno.test("REQ-376 adminGateFor — the presenter's language, never the customer's: a Spanish staff reads Spanish", () => {
  const gate = adminGateFor(
    { ...impersonating, impersonator: { ...staff, language: "es" } },
    presenting,
  );
  assertEquals(gate?.lang, "es");
});

Deno.test("REQ-376 adminGateFor — an impersonation with no demo (the admin console's Impersonate): no demo to go back to", () => {
  assertEquals(
    adminGateFor(impersonating, {
      role: null,
      session: null,
      targetPath: null,
      pid: null,
    }),
    { customer: "Ana Torres", demoId: null, presenters: 0, lang: "en" },
  );
  assertEquals(adminGateFor(impersonating, undefined)?.demoId, null);
});

Deno.test("REQ-376 adminGateFor — a placeholder name is not a name: the business, else the phone", () => {
  const who = { ...impersonating, user: { ...customer, name: "New user" } };
  assertEquals(adminGateFor(who, presenting)?.customer, "Torres Roofing");
});

Deno.test("REQ-376 adminGateFor — not an impersonation (a plain customer, a failed whoami): no interstitial", () => {
  assertEquals(
    adminGateFor(
      { authenticated: true, user: customer, impersonating: false },
      undefined,
    ),
    null,
  );
  assertEquals(adminGateFor(undefined, presenting), null);
  assertEquals(adminGateFor({ authenticated: false }, presenting), null);
});

Deno.test("REQ-376 the interstitial's words exist in en and es", () => {
  const keys = ["adminGate.title", "adminGate.body", "adminGate.secondDemo"];
  const dicts = { en, es } as Record<string, Record<string, string>>;
  for (const lang of ["en", "es"]) {
    for (const k of keys) {
      assert(dicts[lang][k], `${lang}.json carries ${k}`);
    }
    assert(dicts[lang]["adminGate.title"].includes("{name}"));
  }
});
