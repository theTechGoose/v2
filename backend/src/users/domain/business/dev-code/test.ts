/**
 * REQ-082 — Raphael, 2026-10-16: "for the fake you should have a pop up with the code."
 * The code rides the send-otp reply ONLY when the app runs on the fakes: DENO_DEPLOY unset
 * (REQ-318) and not on Deno Deploy (DENO_DEPLOYMENT_ID unset). Either set, nothing.
 */
import { assertEquals } from "#std/assert";
import { devCodeFor } from "./mod.ts";

const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });

Deno.test("REQ-082 devCodeFor — the code comes back on the fakes (neither switch set)", () => {
  assertEquals(devCodeFor("483920", env({})), "483920");
  assertEquals(
    devCodeFor("483920", env({ DENO_DEPLOY: "", DENO_DEPLOYMENT_ID: "  " })),
    "483920",
    "blank is unset",
  );
});

Deno.test("REQ-082 devCodeFor — nothing on the real deploy: DENO_DEPLOY set", () => {
  assertEquals(devCodeFor("483920", env({ DENO_DEPLOY: "true" })), undefined);
  assertEquals(devCodeFor("483920", env({ DENO_DEPLOY: "1" })), undefined);
});

Deno.test("REQ-082 devCodeFor — nothing on Deno Deploy itself: DENO_DEPLOYMENT_ID set", () => {
  assertEquals(
    devCodeFor("483920", env({ DENO_DEPLOYMENT_ID: "abc123" })),
    undefined,
  );
});
