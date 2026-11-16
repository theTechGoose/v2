/**
 * REQ-899 — Twilio request signature (X-Twilio-Signature).
 *
 * Twilio signs every webhook: take the full URL it requested (scheme, host,
 * path, query), append each POST field as key+value in key order, HMAC-SHA1
 * with the account's auth token, base64. A request whose header does not
 * match is not from Twilio. https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */

const enc = new TextEncoder();

export async function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

export interface SignedRequest {
  authToken: string;
  /** the public URL Twilio requested, exactly as Twilio saw it */
  url: string;
  /** the decoded form fields (empty for a GET) */
  params: Record<string, string>;
  /** the X-Twilio-Signature header, null when absent */
  signature: string | null;
}

/** constant-time string compare (both already short ASCII) */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyTwilioSignature(req: SignedRequest): Promise<boolean> {
  if (!req.signature || !req.authToken) return false;
  const expected = await twilioSignature(req.authToken, req.url, req.params);
  return sameString(expected, req.signature);
}
