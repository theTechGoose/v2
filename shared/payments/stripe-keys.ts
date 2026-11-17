/**
 * REQ-212 — the pure rules for a business's Stripe keys: what kind a key is, which mode, whether
 * it is one of the in-process fake's keys, how a pair must match, and how a secret is shown.
 * Shared by the backend (the connect endpoint) and the settings island (the form's own checks).
 */
export const STRIPE_API = "https://api.stripe.com";
/** the in-process fake's tokenization base, through the app's /api proxy (REQ-212) */
export const FAKE_STRIPE_API = "/api/dev/stripe";

export type StripeKeyKind = "publishable" | "secret" | "restricted" | "invalid";
export type StripeMode = "test" | "live";
export type StripeKeyInfo =
  | {
    kind: "publishable" | "secret" | "restricted";
    mode: StripeMode;
    fake: boolean;
  }
  | { kind: "invalid"; fake: false };

const KEY_RE = /^(pk|sk|rk)_(test|live)_([A-Za-z0-9_]+)$/;

export function stripeKeyInfo(raw: string): StripeKeyInfo {
  const m = KEY_RE.exec((raw ?? "").trim());
  if (!m) return { kind: "invalid", fake: false };
  const kind = m[1] === "pk"
    ? "publishable"
    : m[1] === "sk"
    ? "secret"
    : "restricted";
  const mode = m[2] as StripeMode;
  // a fake key is a TEST key whose body starts with "fake_": sk_test_fake_acme (REQ-212)
  const fake = mode === "test" && m[3].startsWith("fake_");
  return { kind, mode, fake };
}

export type KeyPairProblem =
  | "publishable_invalid"
  | "secret_invalid"
  | "mode_mismatch"
  | "fake_mismatch";

export function checkKeyPair(
  publishableKey: string,
  secretKey: string,
): { ok: true; mode: StripeMode; fake: boolean } | {
  ok: false;
  reason: KeyPairProblem;
} {
  const pk = stripeKeyInfo(publishableKey);
  if (pk.kind !== "publishable") {
    return { ok: false, reason: "publishable_invalid" };
  }
  const sk = stripeKeyInfo(secretKey);
  if (sk.kind !== "secret" && sk.kind !== "restricted") {
    return { ok: false, reason: "secret_invalid" };
  }
  if (pk.mode !== sk.mode) return { ok: false, reason: "mode_mismatch" };
  if (pk.fake !== sk.fake) return { ok: false, reason: "fake_mismatch" };
  return { ok: true, mode: pk.mode, fake: pk.fake };
}

/** `sk_test_51abcdefWXYZ` → `sk_test_••••WXYZ`: the prefix says what it is, the tail which one. */
export function maskSecret(secretKey: string): string {
  const key = (secretKey ?? "").trim();
  if (!key) return "";
  const m = /^((?:pk|sk|rk)_(?:test|live)_)/.exec(key);
  const prefix = m ? m[1] : "";
  return `${prefix}••••${key.slice(-4)}`;
}

/** Where the browser sends the card: Stripe itself, or the in-process fake for a fake key. */
export function stripeApiBaseFor(publishableKey: string): string {
  return stripeKeyInfo(publishableKey).fake ? FAKE_STRIPE_API : STRIPE_API;
}
