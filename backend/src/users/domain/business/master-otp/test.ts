// REQ-286 (demo issue test-setup-claims-m1) — the master OTP 000000 is open only on the fakes,
// by the same switch as every other real-vs-fake seam (REQ-318's onRealDeploy): DENO_DEPLOY set,
// or Deno Deploy's own DENO_DEPLOYMENT_ID, and it is refused. Pure: the env is a parameter.
import { assertEquals } from "#std/assert";
import { acceptsMasterCode, MASTER_OTP_CODE } from "./mod.ts";

const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });

Deno.test("REQ-286 acceptsMasterCode — the fakes (neither switch set, or blank) take 000000", () => {
  assertEquals(MASTER_OTP_CODE, "000000");
  assertEquals(acceptsMasterCode("000000", env({})), true);
  assertEquals(
    acceptsMasterCode(
      "000000",
      env({ DENO_DEPLOY: " ", DENO_DEPLOYMENT_ID: "" }),
    ),
    true,
  );
});

Deno.test("REQ-286 acceptsMasterCode — DENO_DEPLOY set off Deno Deploy (no DENO_DEPLOYMENT_ID) refuses 000000", () => {
  assertEquals(acceptsMasterCode("000000", env({ DENO_DEPLOY: "1" })), false);
  assertEquals(
    acceptsMasterCode("000000", env({ DENO_DEPLOY: "true" })),
    false,
  );
});

Deno.test("REQ-286 acceptsMasterCode — Deno Deploy itself (DENO_DEPLOYMENT_ID) refuses 000000", () => {
  assertEquals(
    acceptsMasterCode("000000", env({ DENO_DEPLOYMENT_ID: "abc123" })),
    false,
  );
});

Deno.test("REQ-286 acceptsMasterCode — any other code is never the master code", () => {
  assertEquals(acceptsMasterCode("123456", env({})), false);
  assertEquals(acceptsMasterCode("", env({})), false);
  assertEquals(acceptsMasterCode("0000000", env({})), false);
});
