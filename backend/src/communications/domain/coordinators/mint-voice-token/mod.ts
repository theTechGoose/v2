/** REQ-900 — a softphone token for a signed-in user. */
import { Injectable } from "#danet/core";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { mintVoiceToken, type VoiceToken } from "@communications/domain/business/voice-token/mod.ts";

export class VoiceNotConfiguredError extends Error {
  readonly status: number = 503;
  constructor() {
    super("voice is not configured: set COMMS_TWILIO_ACCOUNT_SID, COMMS_TWILIO_API_KEY_SID, COMMS_TWILIO_API_KEY_SECRET and COMMS_TWILIO_TWIML_APP_SID");
    this.name = "VoiceNotConfiguredError";
  }
}

@Injectable()
export class MintVoiceToken {
  constructor(private cfgSource: CommsConfigSource) {}

  mint(userId: string): Promise<VoiceToken> {
    const cfg = this.cfgSource.get();
    if (!cfg.accountSid || !cfg.apiKeySid || !cfg.apiKeySecret || !cfg.twimlAppSid) {
      return Promise.reject(new VoiceNotConfiguredError());
    }
    return mintVoiceToken({
      accountSid: cfg.accountSid,
      apiKeySid: cfg.apiKeySid,
      apiKeySecret: cfg.apiKeySecret,
      twimlAppSid: cfg.twimlAppSid,
      identity: userId,
    });
  }
}
