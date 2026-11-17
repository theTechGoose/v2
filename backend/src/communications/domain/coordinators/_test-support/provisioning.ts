/** a Twilio that answers every provisioning call, remembering each one */
import type { TwilioClient } from "@communications/domain/data/twilio-client/mod.ts";

export class ProvisioningTwilio {
  calls: { op: string; args: Record<string, unknown> }[] = [];
  failBuyWith: { ok: false; reason: string; code?: number } | null = null;
  private n = 0;

  createSubaccount(input: { friendlyName: string }) {
    this.calls.push({ op: "createSubaccount", args: input });
    this.n++;
    return Promise.resolve({ ok: true as const, sid: `ACsub${this.n}`, authToken: `sub${this.n}-token` });
  }
  createApiKey(input: { accountSid: string; friendlyName: string }) {
    this.calls.push({ op: "createApiKey", args: input });
    return Promise.resolve({ ok: true as const, sid: `SKsub${this.n}`, secret: `sub${this.n}-secret` });
  }
  createTwimlApp(input: { accountSid: string; friendlyName: string; voiceUrl: string }) {
    this.calls.push({ op: "createTwimlApp", args: input });
    return Promise.resolve({ ok: true as const, sid: `APsub${this.n}` });
  }
  buyNumber(input: { accountSid: string; phoneNumber: string; friendlyName?: string; voiceUrl: string; smsUrl: string; statusCallback: string }) {
    this.calls.push({ op: "buyNumber", args: input });
    if (this.failBuyWith) return Promise.resolve(this.failBuyWith);
    return Promise.resolve({ ok: true as const, sid: `PNsub${this.n}`, phoneNumber: input.phoneNumber });
  }
  releaseNumber(input: { accountSid: string; numberSid: string }) {
    this.calls.push({ op: "releaseNumber", args: input });
    return Promise.resolve({ ok: true as const });
  }
  closeSubaccount(input: { accountSid: string }) {
    this.calls.push({ op: "closeSubaccount", args: input });
    return Promise.resolve({ ok: true as const });
  }
  searchAvailable(input: { areaCode?: string; contains?: string; limit?: number }) {
    this.calls.push({ op: "searchAvailable", args: input });
    return Promise.resolve({ ok: true as const, numbers: [{ phoneNumber: "+18435550100", friendlyName: "(843) 555-0100", locality: "Myrtle Beach", region: "SC", capabilities: { voice: true, sms: true, mms: true } }] });
  }
  asClient(): TwilioClient {
    return this as unknown as TwilioClient;
  }
}
