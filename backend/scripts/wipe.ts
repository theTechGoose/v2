/**
 * wipe — reset YOUR prod account so you can sign in fresh (no OTP).
 *
 * Calls the secret-gated `POST /me/reset-by-phone` endpoint on prod, which runs
 * the same full WipeAccount sweep as the Settings danger-zone button but
 * resolves the target by phone instead of by session. Because it's gated by a
 * shared secret (never an open endpoint), only someone holding RESET_SECRET can
 * call it.
 *
 * The secret is read from `backend/.reset.secret` (gitignored) or the
 * RESET_SECRET env var. The SAME value must be set as `RESET_SECRET` in the
 * prod (Deno Deploy) environment for the endpoint to accept the call.
 *
 * Usage:
 *   cd backend && deno task wipe                 # wipes the default phone
 *   cd backend && deno task wipe +18435551234    # wipes another number
 *   WIPE_URL=https://staging.example.com deno task wipe   # different target
 */

const DEFAULT_PHONE = "+18438557133";
const DEFAULT_URL = "https://paperworkmonster.com";

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  Deno.exit(1);
}

function normalizeE164(raw: string): string {
  const s = raw.trim();
  if (/^\+\d{8,15}$/.test(s)) return s;
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return "";
}

async function readSecret(): Promise<string> {
  const fromEnv = Deno.env.get("RESET_SECRET");
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  for (const p of ["./.reset.secret", "../.reset.secret"]) {
    try {
      const v = (await Deno.readTextFile(p)).trim();
      if (v) return v;
    } catch { /* not there — try next */ }
  }
  return "";
}

const base = (Deno.env.get("WIPE_URL") ?? DEFAULT_URL).trim().replace(/\/+$/, "");
const phoneArg = Deno.args.find((a) => /\d/.test(a));
const phone = normalizeE164(phoneArg ?? Deno.env.get("WIPE_PHONE") ?? DEFAULT_PHONE);
if (!phone) fail(`invalid phone: ${phoneArg}`);

const secret = await readSecret();
if (!secret) {
  fail(
    "no RESET_SECRET — put it in backend/.reset.secret (same value set in the " +
      "prod Deno Deploy env), or export RESET_SECRET.",
  );
}

console.log(`→ wiping ${phone} on ${base} …`);
let res: Response;
try {
  res = await fetch(`${base}/me/reset-by-phone`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-reset-secret": secret,
      "accept": "application/json",
    },
    body: JSON.stringify({ phoneNumber: phone }),
  });
} catch (err) {
  fail(`could not reach ${base}: ${err instanceof Error ? err.message : err}`);
}

const body = await res.json().catch(() => ({}));
if (!res.ok && res.status !== 201) {
  fail(`HTTP ${res.status}: ${JSON.stringify(body)}`);
}
if ((body as { ok?: boolean }).ok === false) {
  const err = (body as { error?: string }).error;
  if (err === "forbidden") {
    fail(
      "rejected: secret mismatch. Ensure backend/.reset.secret matches the " +
        "RESET_SECRET set in the prod Deno Deploy environment (and that prod " +
        "has finished deploying the reset-by-phone endpoint).",
    );
  }
  fail(`rejected: ${err ?? "unknown error"}`);
}

const deleted = (body as { deleted?: number }).deleted ?? 0;
const note = (body as { note?: string }).note;
if (note === "no_such_user") {
  console.log(`✓ ${phone} already absent (nothing to delete) — sign in fresh.`);
} else {
  console.log(`✓ wiped ${deleted} keys for ${phone}. Sign in to start fresh.`);
}
