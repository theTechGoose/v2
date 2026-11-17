/**
 * REQ-899 — what a Twilio webhook request is made of, in one shape the
 * signature check and every coordinator consume: the public URL Twilio
 * requested (rebuilt from COMMS_PUBLIC_URL because a proxy sits in front of
 * us), the decoded form fields, and the signature header.
 */
import type { SignedRequest } from "@communications/domain/business/twilio-signature/mod.ts";

export interface TwilioWebhook extends SignedRequest {
  /** the form fields, as Twilio names them (From, To, Body, CallSid, …) */
  params: Record<string, string>;
}

export function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

/** the URL Twilio signed: our public origin + the path and query it requested */
export function signedUrl(publicOrigin: string, requestUrl: string): string {
  const u = new URL(requestUrl);
  const origin = publicOrigin.replace(/\/+$/, "");
  return `${origin}${u.pathname}${u.search}`;
}

export function webhookFromParts(p: {
  authToken: string;
  publicOrigin: string;
  requestUrl: string;
  rawBody: string;
  signature: string | null;
}): TwilioWebhook {
  return {
    authToken: p.authToken,
    url: signedUrl(p.publicOrigin, p.requestUrl),
    params: parseForm(p.rawBody),
    signature: p.signature,
  };
}

/** Twilio's MediaUrl0..N fields */
export function mediaUrls(params: Record<string, string>): string[] {
  const n = Number(params.NumMedia ?? 0) || 0;
  const urls: string[] = [];
  for (let i = 0; i < n; i++) if (params[`MediaUrl${i}`]) urls.push(params[`MediaUrl${i}`]);
  return urls;
}
