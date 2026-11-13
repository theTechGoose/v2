/**
 * REQ-806 — the approve-link door (pure rules). Claude asks to view one account; the super-admin
 * phone gets a one-time approve link; approving opens a read-only view of that account for 30
 * minutes. Its own endpoints (/ops/*) and its own session kind: sign-in, /admin and every other
 * session work exactly as before.
 */

/** an ask waits this long for a tap */
export const OPS_REQUEST_TTL_MS = 10 * 60_000;
/** an approved view lives this long */
export const OPS_VIEW_TTL_MS = 30 * 60_000;
/** the most asks (and so texts) an hour, from anyone */
export const OPS_REQUESTS_PER_HOUR = 10;

export type OpsStored = "pending" | "approved" | "denied" | "no_match";
export type OpsStatus = OpsStored | "expired";

export interface OpsRequest {
  id: string;
  /** sha-256 of the requester's poll token */
  pollHash: string;
  /** sha-256 of the approve link's token */
  approveHash: string;
  /** what the requester typed: a phone, a name, a business */
  query: string;
  reason: string;
  status: OpsStored;
  createdAt: string;
  expiresAt: string;
  /** the one account the query matched */
  targetUserId?: string;
  /** "A2Z Landscape LLC (+15408303528)" — what the approver reads */
  targetLabel?: string;
  decidedAt?: string;
  /** the view's session, until the poller takes it (then dropped from the record) */
  sessionId?: string;
  /** when the poller took it */
  deliveredAt?: string;
}

/** 32 random bytes, base64url — an approve or poll token */
export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(
    /\//g,
    "_",
  ).replace(/=+$/, "");
}

/** what is stored instead of a token */
export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

/** the ask's status now: a pending ask past its 10 minutes is expired */
export function opsStatus(
  r: { status: OpsStored; expiresAt: string },
  now = Date.now(),
): OpsStatus {
  if (r.status === "pending" && now > Date.parse(r.expiresAt)) return "expired";
  return r.status;
}

/** the text the super-admin phone gets */
export function approveText(
  a: { account: string; reason: string; url: string },
): string {
  const why = a.reason.trim() ? ` Reason: ${a.reason.trim()}.` : "";
  return `DocuMonster: Claude asks to view ${a.account} (read-only, 30 min).${why} Approve or deny: ${a.url}`;
}

export const isWriteMethod = (method: string) =>
  !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/**
 * Why a session may not serve this request, or null: a read-only view never writes, and any
 * session with an expiry is dead after it. Sessions without these fields are never refused here.
 */
export function sessionRefusal(
  s: { readOnly?: boolean; expiresAt?: string },
  method: string,
  now = Date.now(),
): "expired" | "read_only" | null {
  if (s.expiresAt && now > Date.parse(s.expiresAt)) return "expired";
  if (s.readOnly && isWriteMethod(method)) return "read_only";
  return null;
}
