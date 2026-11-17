/**
 * REQ-904 — which line a request is about. Two kinds exist: the env line
 * (the main account, `COMMS_TWILIO_*`) and a customer's line on a subaccount.
 * Every coordinator consumes a ResolvedLine and never asks which kind it is.
 */
import type { CommsConfig } from "@communications/domain/data/config/mod.ts";
import type { Line } from "@communications/dto/mod.ts";

export interface ResolvedLine {
  /** REQ-920b: "main" — a bought number moved to the main account under the platform's registration */
  kind: "env" | "subaccount" | "main";
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

export type LineRef = { kind: "env" } | {
  kind: "subaccount";
  subaccountSid: string;
} | { kind: "unknown" };

/** a Twilio webhook names its account: the main account is the env line, any other SID is a subaccount */
export function lineRefForWebhook(
  mainAccountSid: string,
  params: Record<string, string>,
): LineRef {
  const sid = (params.AccountSid ?? "").trim();
  if (!sid) return { kind: "unknown" };
  if (mainAccountSid && sid === mainAccountSid) return { kind: "env" };
  return { kind: "subaccount", subaccountSid: sid };
}

/** the env line is one user's — the one named in COMMS_ENV_LINE_OWNER — and only exists when a number is configured */
export function ownsEnvLine(
  userId: string,
  cfg: Pick<CommsConfig, "from" | "envLineOwner">,
): boolean {
  return Boolean(cfg.from) && Boolean(cfg.envLineOwner) &&
    userId === cfg.envLineOwner;
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

/** the number a webhook was delivered to (To for texts and calls, Called on some voice events); "" when it is not a number */
export function webhookTo(params: Record<string, string>): string {
  const raw = (params.To ?? params.Called ?? "").trim();
  return /^\+[1-9]\d{6,14}$/.test(raw) ? raw : "";
}

/**
 * a stored line plus its opened secrets; its owner is the one softphone to ring.
 * REQ-920b: a main-account line runs on the main credentials (`cfg`) with its own key and app.
 */
export function resolvedFromLine(
  line: Line,
  secrets: { authToken: string; apiKeySecret: string },
  cfg?: Pick<CommsConfig, "accountSid" | "authToken">,
): ResolvedLine {
  const main = line.kind === "main";
  return {
    kind: main ? "main" : "subaccount",
    userId: line.userId,
    number: line.number,
    accountSid: main ? cfg?.accountSid ?? "" : line.subaccountSid,
    authToken: main ? cfg?.authToken ?? "" : secrets.authToken,
    apiKeySid: line.apiKeySid,
    apiKeySecret: secrets.apiKeySecret,
    twimlAppSid: line.twimlAppSid,
    ringIdentities: [line.userId],
  };
}
