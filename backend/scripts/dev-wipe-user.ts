/**
 * dev-wipe-user — local-only KV scrub by phone number.
 *
 * Resolves the userId via the user_by_phone index, then deletes every key
 * in KV that touches either the phone or the userId. Intended for the
 * onboarding cypress spec which needs a fresh "never seen this number"
 * state on every test.
 *
 * Usage: deno run -A --unstable-kv scripts/dev-wipe-user.ts +18438557133
 */
import { getKv } from "../src/core/data/kv/mod.ts";

const phone = Deno.args[0];
if (!phone || !phone.startsWith("+")) {
  console.error("usage: dev-wipe-user.ts <E.164 phone, e.g. +18438557133>");
  Deno.exit(2);
}

const kv = await getKv();
const idx = await kv.get<string>(["user_by_phone", phone]);
const targets = new Set<string>([phone]);
if (typeof idx.value === "string") targets.add(idx.value);

let deleted = 0;
let batch = kv.atomic();
let staged = 0;
for await (const e of kv.list({ prefix: [] })) {
  if (e.key.some((seg) => targets.has(String(seg)))) {
    batch.delete(e.key);
    deleted++;
    staged++;
    if (staged >= 100) {
      await batch.commit();
      batch = kv.atomic();
      staged = 0;
    }
  }
}
if (staged > 0) await batch.commit();
console.log(`wiped ${deleted} keys for ${phone}`);
kv.close();
