/** REQ-900/904 — a softphone token for a signed-in user, from their line's API key. */
import { Injectable } from "#danet/core";
import { mintVoiceToken, type VoiceToken } from "@communications/domain/business/voice-token/mod.ts";
import { LineContext } from "@communications/domain/coordinators/line-context/mod.ts";

export class VoiceNotConfiguredError extends Error {
  readonly status: number = 503;
  constructor() {
    super("voice is not configured on this line: it needs an account SID, an API key (SID + secret) and a TwiML App SID");
    this.name = "VoiceNotConfiguredError";
  }
}

@Injectable()
export class MintVoiceToken {
  constructor(private lineContext: LineContext) {}

  async mint(userId: string): Promise<VoiceToken> {
    const line = await this.lineContext.forUser(userId);
    if (!line.accountSid || !line.apiKeySid || !line.apiKeySecret || !line.twimlAppSid) throw new VoiceNotConfiguredError();
    return await mintVoiceToken({
      accountSid: line.accountSid,
      apiKeySid: line.apiKeySid,
      apiKeySecret: line.apiKeySecret,
      twimlAppSid: line.twimlAppSid,
      identity: userId,
    });
  }
}
