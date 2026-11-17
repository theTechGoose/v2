/**
 * REQ-903/905 — a customer's own line: a Twilio subaccount of ours (so its
 * usage bills to us), an API key for their softphone, a TwiML App for outbound
 * dialing, and the number, all webhooks pointed at us. The customer never
 * sees Twilio. If any step after the subaccount fails, the subaccount is
 * closed again so nothing half-made is left behind.
 */
import { Injectable } from "#danet/core";
import type {
  AvailableNumber,
  BuyNumberInput,
  PublicLine,
} from "@communications/dto/mod.ts";
import { redactLine } from "@communications/dto/mod.ts";
import {
  CommsConfigSource,
  publicUrl,
  ROUTES,
} from "@communications/domain/data/config/mod.ts";
import type { NumberSearch } from "@communications/domain/business/numbers/mod.ts";
import {
  type Failure,
  TwilioClient,
} from "@communications/domain/data/twilio-client/mod.ts";
import { LineStore } from "@communications/domain/data/line-store/mod.ts";

export class LineConflictError extends Error {
  readonly status: number = 409;
  readonly code = "line_exists";
  constructor() {
    super("this account already has an active line; release it first");
    this.name = "LineConflictError";
  }
}

/** Twilio refused or failed a provisioning step (502: the fault is upstream) */
/** REQ-918b: a webhook URL only when we have a public one — a relative path would be refused by Twilio */
const hook = (cfg: { publicUrl: string }, route: string): string =>
  cfg.publicUrl ? publicUrl(cfg, route) : "";

export class ProvisioningError extends Error {
  readonly status: number = 502;
  readonly code?: number;
  /** REQ-917: the upstream reason by itself (`not_configured` when the server has no keys), so the body names it */
  readonly reason: string;
  constructor(step: string, failure: Failure) {
    super(`${step}: ${failure.reason}`);
    this.name = "ProvisioningError";
    this.reason = failure.reason;
    if (failure.code !== undefined) this.code = failure.code;
  }
}

@Injectable()
export class Lines {
  constructor(
    private twilio: TwilioClient,
    private lines: LineStore,
    private cfgSource: CommsConfigSource,
  ) {}

  async search(search: NumberSearch): Promise<AvailableNumber[]> {
    const res = await this.twilio.searchAvailable(search);
    if (!res.ok) throw new ProvisioningError("search", res);
    return res.numbers;
  }

  async get(userId: string): Promise<PublicLine | null> {
    const line = await this.lines.findByUser(userId);
    return line ? redactLine(line) : null;
  }

  async buy(userId: string, input: BuyNumberInput): Promise<PublicLine> {
    if (await this.lines.findActiveByUser(userId)) {
      throw new LineConflictError();
    }
    const cfg = this.cfgSource.get();
    const label = `documonster:${userId}`;

    const sub = await this.twilio.createSubaccount({ friendlyName: label });
    if (!sub.ok) throw new ProvisioningError("subaccount", sub);

    const rollback = async (step: string, failure: Failure): Promise<never> => {
      const closed = await this.twilio.closeSubaccount({ accountSid: sub.sid });
      if (!closed.ok) {
        console.error(
          `[communications/lines] rollback could not close ${sub.sid}: ${closed.reason}`,
        );
      }
      throw new ProvisioningError(step, failure);
    };

    const key = await this.twilio.createApiKey({
      accountSid: sub.sid,
      friendlyName: `${label} softphone`,
    });
    if (!key.ok) return rollback("api key", key);

    const app = await this.twilio.createTwimlApp({
      accountSid: sub.sid,
      friendlyName: `${label} softphone`,
      voiceUrl: hook(cfg, ROUTES.voiceOutgoing),
    });
    if (!app.ok) return rollback("twiml app", app);

    const number = await this.twilio.buyNumber({
      accountSid: sub.sid,
      phoneNumber: input.phoneNumber,
      ...(input.friendlyName ? { friendlyName: input.friendlyName } : {}),
      voiceUrl: hook(cfg, ROUTES.voiceIncoming),
      smsUrl: hook(cfg, ROUTES.sms),
      statusCallback: hook(cfg, ROUTES.voiceStatus),
    });
    if (!number.ok) return rollback("number", number);

    const line = await this.lines.create({
      userId,
      subaccountSid: sub.sid,
      number: number.phoneNumber,
      numberSid: number.sid,
      apiKeySid: key.sid,
      twimlAppSid: app.sid,
      ...(input.friendlyName ? { friendlyName: input.friendlyName } : {}),
      authToken: sub.authToken,
      apiKeySecret: key.secret,
    });
    return redactLine(line);
  }

  /** give the number back and close the subaccount; a released (or absent) line is left as it is */
  async release(userId: string): Promise<PublicLine | null> {
    const line = await this.lines.findByUser(userId);
    if (!line) return null;
    if (line.status === "released") return redactLine(line);
    // REQ-920b: a main-account line is released on the main account; there is no subaccount to close
    const accountSid = line.kind === "main"
      ? this.cfgSource.get().accountSid
      : line.subaccountSid;
    const freed = await this.twilio.releaseNumber({
      accountSid,
      numberSid: line.numberSid,
    });
    if (!freed.ok) throw new ProvisioningError("release number", freed);
    if (line.kind !== "main") {
      const closed = await this.twilio.closeSubaccount({
        accountSid: line.subaccountSid,
      });
      if (!closed.ok) throw new ProvisioningError("close subaccount", closed);
    }
    return redactLine(await this.lines.markReleased(line.id));
  }
}
