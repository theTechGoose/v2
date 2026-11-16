/** REQ-900 — the softphone token comes from the line's API key; without one the endpoint says so (503). */
import "#reflect-metadata";
import { assertEquals, assertRejects } from "#std/assert";
import { decodeJwt, verifyJwtHs256 } from "@communications/domain/business/voice-token/mod.ts";
import { freshLine, stores } from "../_test-support/mod.ts";
import { LineContext, NoLineError } from "../line-context/mod.ts";
import { MintVoiceToken, VoiceNotConfiguredError } from "./mod.ts";

const OWNER = "0b8c2b3e-1d2f-4a5b-9c6d-7e8f9a0b1c2d";
const minter = async (cfg: Awaited<ReturnType<typeof freshLine>>["cfg"]) => new MintVoiceToken(new LineContext((await stores()).lines, cfg));

Deno.test("REQ-900 mint-voice-token int: a user's token names them, is signed by the API key secret, and grants the TwiML app", async () => {
  const { restore, cfg } = await freshLine({ COMMS_ENV_LINE_OWNER: OWNER });
  try {
    const out = await (await minter(cfg)).mint(OWNER);
    assertEquals(out.identity, "0b8c2b3e_1d2f_4a5b_9c6d_7e8f9a0b1c2d");
    assertEquals(await verifyJwtHs256(out.token, "sk-secret"), true);
    const { payload } = decodeJwt(out.token);
    assertEquals(payload.iss, "SKtest");
    assertEquals(payload.sub, "ACtest");
    assertEquals(payload.grants.voice.outgoing.application_sid, "APtest");
    // REQ-904: a user without a line gets no token
    await assertRejects(async () => (await minter(cfg)).mint("someone_else"), NoLineError);
  } finally {
    await restore();
  }
});

Deno.test("REQ-900 mint-voice-token int: no API key / TwiML app → VoiceNotConfiguredError (503)", async () => {
  const { restore, cfg } = await freshLine({ COMMS_TWILIO_API_KEY_SECRET: undefined, COMMS_ENV_LINE_OWNER: "u1" });
  try {
    await assertRejects(async () => (await minter(cfg)).mint("u1"), VoiceNotConfiguredError);
    assertEquals(new VoiceNotConfiguredError().status, 503);
  } finally {
    await restore();
  }
});
