// REQ-103 / REQ-318 — the one real-vs-fake switch as a predicate, for every adapter that must stay
// off the wire on the fakes: DENO_DEPLOY set (REQ-318), or Deno Deploy's own DENO_DEPLOYMENT_ID.
// Pure: the env is a parameter.
import { assertEquals } from "#std/assert";
import { onRealDeploy } from "./mod.ts";

const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });

Deno.test("REQ-103 onRealDeploy — the fakes: neither switch set, or set blank", () => {
  assertEquals(onRealDeploy(env({})), false);
  assertEquals(
    onRealDeploy(env({ DENO_DEPLOY: "", DENO_DEPLOYMENT_ID: "  " })),
    false,
    "blank is unset",
  );
});

Deno.test("REQ-103 onRealDeploy — the real deploy: DENO_DEPLOY set, or DENO_DEPLOYMENT_ID set", () => {
  assertEquals(onRealDeploy(env({ DENO_DEPLOY: "true" })), true);
  assertEquals(onRealDeploy(env({ DENO_DEPLOY: "1" })), true);
  assertEquals(onRealDeploy(env({ DENO_DEPLOYMENT_ID: "abc123" })), true);
});
