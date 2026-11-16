/** REQ-900 — the Twilio Voice access token, minted by hand (HS256 JWT, cty twilio-fpa;v=1). */
import { assert, assertEquals, assertRejects } from "#std/assert";
import { decodeJwt, mintVoiceToken, verifyJwtHs256 } from "./mod.ts";

const creds = {
  accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  apiKeySid: "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  apiKeySecret: "shhh-secret",
  twimlAppSid: "APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
};

Deno.test("REQ-900 mintVoiceToken: header, claims and the voice grant are what Twilio documents", async () => {
  const now = 1_700_000_000;
  const out = await mintVoiceToken({ ...creds, identity: "user_42", ttlSec: 3600, now, jti: "SKx-abc" });
  const { header, payload } = decodeJwt(out.token);
  assertEquals(header, { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" });
  assertEquals(payload.jti, "SKx-abc");
  assertEquals(payload.iss, creds.apiKeySid);
  assertEquals(payload.sub, creds.accountSid);
  assertEquals(payload.iat, now);
  assertEquals(payload.exp, now + 3600);
  assertEquals(payload.grants, {
    identity: "user_42",
    voice: { incoming: { allow: true }, outgoing: { application_sid: creds.twimlAppSid } },
  });
  assertEquals(out.identity, "user_42");
  assertEquals(out.ttlSec, 3600);
  assertEquals(out.expiresAt, new Date((now + 3600) * 1000).toISOString());
});

Deno.test("REQ-900 mintVoiceToken: the signature verifies with the API key secret and with nothing else", async () => {
  const out = await mintVoiceToken({ ...creds, identity: "user_42" });
  assertEquals(await verifyJwtHs256(out.token, creds.apiKeySecret), true);
  assertEquals(await verifyJwtHs256(out.token, "wrong"), false);
  assertEquals(await verifyJwtHs256(out.token + "x", creds.apiKeySecret), false);
});

Deno.test("REQ-900 mintVoiceToken: default TTL is one hour, never above Twilio's 24 h, identity is [A-Za-z0-9_] only", async () => {
  const out = await mintVoiceToken({ ...creds, identity: "user_42" });
  assertEquals(out.ttlSec, 3600);
  const capped = await mintVoiceToken({ ...creds, identity: "user_42", ttlSec: 999_999 });
  assertEquals(capped.ttlSec, 86_400);
  // a KV uuid has dashes: it is sanitized to an underscore identity, deterministically
  const uuid = await mintVoiceToken({ ...creds, identity: "0b8c2b3e-1d2f-4a5b-9c6d-7e8f9a0b1c2d" });
  assertEquals(uuid.identity, "0b8c2b3e_1d2f_4a5b_9c6d_7e8f9a0b1c2d");
  await assertRejects(() => mintVoiceToken({ ...creds, identity: "" }), Error, "identity");
  assert(decodeJwt(uuid.token).payload.grants.identity === uuid.identity);
});
