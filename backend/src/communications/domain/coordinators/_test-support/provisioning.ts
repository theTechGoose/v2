/** a Twilio that answers every provisioning call, remembering each one */
import type { TwilioClient } from "@communications/domain/data/twilio-client/mod.ts";

export class ProvisioningTwilio {
  calls: { op: string; args: Record<string, unknown> }[] = [];
  failBuyWith: { ok: false; reason: string; code?: number } | null = null;
  failSearchWith: { ok: false; reason: string; code?: number } | null = null; // REQ-917
  private n = 0;

  createSubaccount(input: { friendlyName: string }) {
    this.calls.push({ op: "createSubaccount", args: input });
    this.n++;
    return Promise.resolve({
      ok: true as const,
      sid: `ACsub${this.n}`,
      authToken: `sub${this.n}-token`,
    });
  }
  createApiKey(input: { accountSid: string; friendlyName: string }) {
    this.calls.push({ op: "createApiKey", args: input });
    return Promise.resolve({
      ok: true as const,
      sid: `SKsub${this.n}`,
      secret: `sub${this.n}-secret`,
    });
  }
  createTwimlApp(
    input: { accountSid: string; friendlyName: string; voiceUrl: string },
  ) {
    this.calls.push({ op: "createTwimlApp", args: input });
    return Promise.resolve({ ok: true as const, sid: `APsub${this.n}` });
  }
  buyNumber(
    input: {
      accountSid: string;
      phoneNumber: string;
      friendlyName?: string;
      voiceUrl: string;
      smsUrl: string;
      statusCallback: string;
    },
  ) {
    this.calls.push({ op: "buyNumber", args: input });
    if (this.failBuyWith) return Promise.resolve(this.failBuyWith);
    return Promise.resolve({
      ok: true as const,
      sid: `PNsub${this.n}`,
      phoneNumber: input.phoneNumber,
    });
  }
  releaseNumber(input: { accountSid: string; numberSid: string }) {
    this.calls.push({ op: "releaseNumber", args: input });
    return Promise.resolve({ ok: true as const });
  }
  closeSubaccount(input: { accountSid: string }) {
    this.calls.push({ op: "closeSubaccount", args: input });
    return Promise.resolve({ ok: true as const });
  }
  searchAvailable(
    input: { areaCode?: string; contains?: string; limit?: number },
  ) {
    this.calls.push({ op: "searchAvailable", args: input });
    if (this.failSearchWith) return Promise.resolve(this.failSearchWith);
    return Promise.resolve({
      ok: true as const,
      numbers: [{
        phoneNumber: "+18435550100",
        friendlyName: "(843) 555-0100",
        locality: "Myrtle Beach",
        region: "SC",
        capabilities: { voice: true, sms: true, mms: true },
      }],
    });
  }
  // ── REQ-920b: the house path ──────────────────────────────────────────────
  verifiedServices: {
    sid: string;
    friendlyName: string;
    usecase: string;
    status: string;
  }[] = [
    {
      sid: "MGsupport",
      friendlyName: "Monster Support",
      usecase: "CUSTOMER_CARE",
      status: "VERIFIED",
    },
    {
      sid: "MGmarketing",
      friendlyName: "Marketing",
      usecase: "MARKETING",
      status: "FAILED",
    },
    { sid: "MGplain", friendlyName: "No campaign", usecase: "", status: "" },
  ];
  failTransferWith: { ok: false; reason: string; code?: number } | null = null;
  transferNumber(input: { numberSid: string; toAccountSid: string }) {
    this.calls.push({ op: "transferNumber", args: input });
    if (this.failTransferWith) return Promise.resolve(this.failTransferWith);
    return Promise.resolve({ ok: true as const });
  }
  updateNumber(
    input: {
      accountSid: string;
      numberSid: string;
      voiceUrl: string;
      smsUrl: string;
      statusCallback: string;
    },
  ) {
    this.calls.push({ op: "updateNumber", args: input });
    return Promise.resolve({ ok: true as const });
  }
  listMessagingServices() {
    this.calls.push({ op: "listMessagingServices", args: {} });
    return Promise.resolve({
      ok: true as const,
      services: this.verifiedServices.map((s) => ({
        sid: s.sid,
        friendlyName: s.friendlyName,
      })),
    });
  }
  listCampaigns(input: { serviceSid: string }) {
    this.calls.push({ op: "listCampaigns", args: input });
    const s = this.verifiedServices.find((x) => x.sid === input.serviceSid);
    return Promise.resolve({
      ok: true as const,
      campaigns: s && s.usecase
        ? [{ sid: `QE${s.sid}`, usecase: s.usecase, status: s.status }]
        : [],
    });
  }
  addNumberToService(input: { serviceSid: string; numberSid: string }) {
    this.calls.push({ op: "addNumberToService", args: input });
    return Promise.resolve({ ok: true as const });
  }

  asClient(): TwilioClient {
    return this as unknown as TwilioClient;
  }
}
