/**
 * REQ-904 — which line a request is about. Two kinds exist: the env line
 * (the main account, `COMMS_TWILIO_*`) and a customer's line on a subaccount.
 * Every coordinator consumes a ResolvedLine and never asks which kind it is.
 */
import type { CommsConfig } from "@communications/domain/data/config/mod.ts";
import type { Line } from "@communications/dto/mod.ts";

export interface ResolvedLine {
  kind: "env" | "subaccount";
  /** the user the line belongs to; absent on an env line nobody owns */
  userId?: string;
  /** E.164 ("" on an unconfigured env line) */
  number: string;
  accountSid: string;
  authToken: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  /** softphone identities an inbound call rings */
  ringIdentities: string[];
}

export type LineRef = { kind: "env" } | { kind: "subaccount"; subaccountSid: string } | { kind: "unknown" };

/** a Twilio webhook names its account: the main account is the env line, any other SID is a subaccount */
export function lineRefForWebhook(mainAccountSid: string, params: Record<string, string>): LineRef {
  const sid = (params.AccountSid ?? "").trim();
  if (!sid) return { kind: "unknown" };
  if (mainAccountSid && sid === mainAccountSid) return { kind: "env" };
  return { kind: "subaccount", subaccountSid: sid };
}

/** the env line is one user's — the one named in COMMS_ENV_LINE_OWNER — and only exists when a number is configured */
export function ownsEnvLine(userId: string, cfg: Pick<CommsConfig, "from" | "envLineOwner">): boolean {
  return Boolean(cfg.from) && Boolean(cfg.envLineOwner) && userId === cfg.envLineOwner;
}

export function envLine(cfg: CommsConfig): ResolvedLine {
  return {
    kind: "env",
    ...(cfg.envLineOwner ? { userId: cfg.envLineOwner } : {}),
    number: cfg.from,
    accountSid: cfg.accountSid,
    authToken: cfg.authToken,
    apiKeySid: cfg.apiKeySid,
    apiKeySecret: cfg.apiKeySecret,
    twimlAppSid: cfg.twimlAppSid,
    ringIdentities: cfg.ringIdentities,
  };
}

/** a stored line plus its opened secrets; its owner is the one softphone to ring */
export function resolvedFromLine(line: Line, secrets: { authToken: string; apiKeySecret: string }): ResolvedLine {
  return {
    kind: "subaccount",
    userId: line.userId,
    number: line.number,
    accountSid: line.subaccountSid,
    authToken: secrets.authToken,
    apiKeySid: line.apiKeySid,
    apiKeySecret: secrets.apiKeySecret,
    twimlAppSid: line.twimlAppSid,
    ringIdentities: [line.userId],
  };
}
