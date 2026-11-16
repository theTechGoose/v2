/**
 * REQ-904 — one line per request. An app endpoint acts on the signed-in
 * user's line (the env line if they own it, else the line they bought, else
 * 409 no_line). A Twilio webhook names its account: the main account is the
 * env line, a known subaccount is that customer's line, anything else is 403.
 */
import { Injectable } from "#danet/core";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { envLine, lineRefForWebhook, ownsEnvLine, resolvedFromLine, type ResolvedLine } from "@communications/domain/business/line-resolution/mod.ts";
import { LineStore } from "@communications/domain/data/line-store/mod.ts";

export class NoLineError extends Error {
  readonly status: number = 409;
  readonly code = "no_line";
  constructor() {
    super("this account has no phone line yet: buy a number first");
    this.name = "NoLineError";
  }
}

export class UnknownLineError extends Error {
  readonly status: number = 403;
  constructor() {
    super("webhook is not for any line of ours");
    this.name = "UnknownLineError";
  }
}

@Injectable()
export class LineContext {
  constructor(private lines: LineStore, private cfgSource: CommsConfigSource) {}

  async forUser(userId: string): Promise<ResolvedLine> {
    const cfg = this.cfgSource.get();
    if (ownsEnvLine(userId, cfg)) return envLine(cfg);
    const line = await this.lines.findActiveByUser(userId);
    if (!line) throw new NoLineError();
    return resolvedFromLine(line, await this.lines.open(line));
  }

  async forWebhook(params: Record<string, string>): Promise<ResolvedLine> {
    const cfg = this.cfgSource.get();
    const ref = lineRefForWebhook(cfg.accountSid, params);
    if (ref.kind === "env") return envLine(cfg);
    if (ref.kind === "unknown") throw new UnknownLineError();
    const line = await this.lines.findBySubaccount(ref.subaccountSid);
    if (!line) throw new UnknownLineError();
    return resolvedFromLine(line, await this.lines.open(line));
  }
}
