/**
 * dev-get-otp — local-only OTP code reader by phone.
 *
 * Prints the latest pending OTP `code` for a phone, so the cypress
 * onboarding spec can finish the login flow with a REAL code (not the
 * dev master bypass — which auto-seeds a Dev User identity and skips
 * onboarding). Errors with exit 1 + a message if no OTP is pending.
 *
 * Usage: deno run -A --unstable-kv scripts/dev-get-otp.ts +18438557133
 */
import { getKv } from "../src/core/data/kv/mod.ts";

const phone = Deno.args[0];
if (!phone || !phone.startsWith("+")) {
  console.error("usage: dev-get-otp.ts <E.164 phone, e.g. +18438557133>");
  Deno.exit(2);
}

const kv = await getKv();
const r = await kv.get<{ code: string }>(["otp", phone]);
if (!r.value?.code) {
  console.error(`no OTP pending for ${phone}`);
  Deno.exit(1);
}
console.log(r.value.code);
kv.close();
