/**
 * REQ-212 — secrets at rest: AES-GCM under SECRETS_KEY; off the real deploy a fixed dev key
 * stands in, on it the key is required.
 */
import { assertEquals, assertNotEquals, assertRejects } from "#std/assert";
import {
  openSecret,
  sealSecret,
  secretsKey,
  SecretsKeyMissing,
} from "./mod.ts";

const KEY_A = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);
const KEY_B = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

Deno.test("REQ-212 secret-box — seal and open round-trip; the sealed form is not the plain one and differs every time", async () => {
  const key = await secretsKey({
    get: (k) => ({ SECRETS_KEY: KEY_A } as Record<string, string>)[k],
  });
  const a = await sealSecret("sk_test_51abc", key);
  const b = await sealSecret("sk_test_51abc", key);
  assertNotEquals(a, b, "a fresh iv every time");
  assertEquals(a.includes("sk_test_51abc"), false);
  assertEquals(a.startsWith("v1."), true);
  assertEquals(await openSecret(a, key), "sk_test_51abc");
  assertEquals(await openSecret(b, key), "sk_test_51abc");
});

Deno.test("REQ-212 secret-box — a different key cannot open it", async () => {
  const keyA = await secretsKey({
    get: (k) => ({ SECRETS_KEY: KEY_A } as Record<string, string>)[k],
  });
  const keyB = await secretsKey({
    get: (k) => ({ SECRETS_KEY: KEY_B } as Record<string, string>)[k],
  });
  const sealed = await sealSecret("sk_test_51abc", keyA);
  await assertRejects(() => openSecret(sealed, keyB));
});

Deno.test("REQ-212 secret-box — off the real deploy, no SECRETS_KEY means the fixed dev key", async () => {
  const env = {
    get: (k: string) => ({} as Record<string, string | undefined>)[k],
  };
  const key = await secretsKey(env);
  const sealed = await sealSecret("sk_test_fake_acme", key);
  assertEquals(
    await openSecret(sealed, await secretsKey(env)),
    "sk_test_fake_acme",
  );
});

Deno.test("REQ-212 secret-box — on the real deploy the key is required", async () => {
  const env = {
    get: (k: string) =>
      ({ DENO_DEPLOY: "1" } as Record<string, string | undefined>)[k],
  };
  await assertRejects(() => secretsKey(env), SecretsKeyMissing);
});

Deno.test("REQ-212 secret-box — a short or malformed SECRETS_KEY is refused", async () => {
  await assertRejects(
    () =>
      secretsKey({
        get: (k) => ({ SECRETS_KEY: "tooshort" } as Record<string, string>)[k],
      }),
    SecretsKeyMissing,
  );
});
