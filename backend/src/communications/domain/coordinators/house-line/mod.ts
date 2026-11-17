/**
 * REQ-920b — the platform's own line texts under the platform's A2P registration.
 * A super admin's bought number moves from its subaccount to the main account, gets a
 * main-account API key + TwiML App for the softphone, has its webhooks pointed at us, and
 * joins one of the main account's messaging services whose campaign is VERIFIED. The now
 * empty subaccount is closed. Only Monster's own business may text under Monster's brand —
 * the controller gates this on the super-admin flag.
 */
import { Injectable } from "#danet/core";
import type { HouseService, PublicLine } from "@communications/dto/mod.ts";
import { redactLine } from "@communications/dto/mod.ts";
import {
  CommsConfigSource,
  publicUrl,
  ROUTES,
} from "@communications/domain/data/config/mod.ts";
import { LineStore } from "@communications/domain/data/line-store/mod.ts";
import { TwilioClient } from "@communications/domain/data/twilio-client/mod.ts";
import { NoLineError } from "../line-context/mod.ts";
import { ProvisioningError } from "../lines/mod.ts";

export class HouseLineError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(
    code: "service_not_verified" | "already_house",
    status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "HouseLineError";
    this.code = code;
    this.status = status;
  }
}

const hook = (cfg: { publicUrl: string }, route: string): string =>
  cfg.publicUrl ? publicUrl(cfg, route) : "";

@Injectable()
export class HouseLine {
  constructor(
    private twilio: TwilioClient,
    private lines: LineStore,
    private cfgSource: CommsConfigSource,
  ) {}

  /** the main account's messaging services with a VERIFIED campaign — the only ones a number may text through */
  async services(): Promise<HouseService[]> {
    const listed = await this.twilio.listMessagingServices();
    if (!listed.ok) throw new ProvisioningError("messaging services", listed);
    const out: HouseService[] = [];
    for (const s of listed.services) {
      const camps = await this.twilio.listCampaigns({ serviceSid: s.sid });
      if (!camps.ok) throw new ProvisioningError("campaigns", camps);
      const verified = camps.campaigns.find((c) => c.status === "VERIFIED");
      if (verified) {
        out.push({
          sid: s.sid,
          friendlyName: s.friendlyName,
          usecase: verified.usecase,
        });
      }
    }
    return out;
  }

  async adopt(userId: string, serviceSid: string): Promise<PublicLine> {
    const line = await this.lines.findActiveByUser(userId);
    if (!line) throw new NoLineError();
    if (line.kind === "main") {
      throw new HouseLineError(
        "already_house",
        409,
        "this line already texts under the platform's registration",
      );
    }
    const service = (await this.services()).find((s) => s.sid === serviceSid);
    if (!service) {
      throw new HouseLineError(
        "service_not_verified",
        400,
        "that messaging service has no verified campaign",
      );
    }
    const cfg = this.cfgSource.get();
    const label = `documonster:${userId}`;

    const moved = await this.twilio.transferNumber({
      numberSid: line.numberSid,
      toAccountSid: cfg.accountSid,
    });
    if (!moved.ok) throw new ProvisioningError("transfer number", moved);

    const key = await this.twilio.createApiKey({
      accountSid: cfg.accountSid,
      friendlyName: `${label} softphone`,
    });
    if (!key.ok) throw new ProvisioningError("api key", key);

    const app = await this.twilio.createTwimlApp({
      accountSid: cfg.accountSid,
      friendlyName: `${label} softphone`,
      voiceUrl: hook(cfg, ROUTES.voiceOutgoing),
    });
    if (!app.ok) throw new ProvisioningError("twiml app", app);

    const pointed = await this.twilio.updateNumber({
      accountSid: cfg.accountSid,
      numberSid: line.numberSid,
      voiceUrl: hook(cfg, ROUTES.voiceIncoming),
      smsUrl: hook(cfg, ROUTES.sms),
      statusCallback: hook(cfg, ROUTES.voiceStatus),
    });
    if (!pointed.ok) throw new ProvisioningError("number webhooks", pointed);

    const joined = await this.twilio.addNumberToService({
      serviceSid,
      numberSid: line.numberSid,
    });
    if (!joined.ok) throw new ProvisioningError("messaging service", joined);

    const closed = await this.twilio.closeSubaccount({
      accountSid: line.subaccountSid,
    });
    if (!closed.ok) {
      console.error(
        `[communications/house-line] could not close the emptied subaccount ${line.subaccountSid}: ${closed.reason}`,
      );
    }

    const next = await this.lines.markMain(line.id, {
      apiKeySid: key.sid,
      apiKeySecret: key.secret,
      twimlAppSid: app.sid,
      messagingServiceSid: serviceSid,
      campaignUsecase: service.usecase,
    });
    return redactLine(next);
  }
}
