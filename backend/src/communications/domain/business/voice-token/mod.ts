/**
 * REQ-900 — a Twilio Access Token for the Voice JS SDK, minted by hand so the
 * backend carries no Twilio SDK: HS256 JWT, header cty "twilio-fpa;v=1",
 * iss = API key SID, sub = account SID, grants.identity + grants.voice.
 * https://www.twilio.com/docs/iam/access-tokens
 */

const enc = new TextEncoder();
export const VOICE_TOKEN_DEFAULT_TTL_SEC = 3600;
export const VOICE_TOKEN_MAX_TTL_SEC = 86_400;

export interface VoiceTokenInput {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  /** who this softphone is; sanitized to [A-Za-z0-9_] (Twilio's rule for Voice identities) */
  identity: string;
  ttlSec?: number;
  /** epoch seconds; defaults to now */
  now?: number;
  jti?: string;
}

export interface VoiceToken {
  token: string;
  identity: string;
  ttlSec: number;
  expiresAt: string;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(v: unknown): string {
  return b64url(enc.encode(JSON.stringify(v)));
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

/** Twilio Voice identities: alphanumerics and underscores only */
export function voiceIdentity(raw: string): string {
  const id = raw.replace(/[^A-Za-z0-9_]/g, "_");
  if (!id) throw new Error("voice token: identity is required");
  return id;
}

export async function mintVoiceToken(input: VoiceTokenInput): Promise<VoiceToken> {
  const identity = voiceIdentity(input.identity);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ttlSec = Math.min(Math.max(1, Math.floor(input.ttlSec ?? VOICE_TOKEN_DEFAULT_TTL_SEC)), VOICE_TOKEN_MAX_TTL_SEC);
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: input.jti ?? `${input.apiKeySid}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    iss: input.apiKeySid,
    sub: input.accountSid,
    iat: now,
    exp: now + ttlSec,
    grants: {
      identity,
      voice: { incoming: { allow: true }, outgoing: { application_sid: input.twimlAppSid } },
    },
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(input.apiKeySecret, ["sign"]), enc.encode(signingInput));
  return {
    token: `${signingInput}.${b64url(new Uint8Array(sig))}`,
    identity,
    ttlSec,
    expiresAt: new Date((now + ttlSec) * 1000).toISOString(),
  };
}

// deno-lint-ignore no-explicit-any
export function decodeJwt(token: string): { header: any; payload: any } {
  const [h, p] = token.split(".");
  const dec = new TextDecoder();
  return { header: JSON.parse(dec.decode(fromB64url(h))), payload: JSON.parse(dec.decode(fromB64url(p))) };
}

export async function verifyJwtHs256(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const key = await hmacKey(secret, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}
