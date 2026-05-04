import { getKv } from "../src/core/data/kv/mod.ts";

const PHONE = "+18438557133";
const kv = await getKv();

// Find user id by phone via the same index the store uses.
const idx = await kv.get<{ id: string }>(["user_by_phone", PHONE]);
if (!idx.value) {
  console.log("no user with phone", PHONE);
  Deno.exit(0);
}
const userId = idx.value.id;
console.log("wiping user", userId, "phone", PHONE);

let deleted = 0;
const txn = kv.atomic();
for await (const entry of kv.list({ prefix: [] })) {
  const k = entry.key;
  const touchesUser = k.some((seg) => seg === userId);
  const touchesPhone = k.some((seg) => seg === PHONE);
  if (touchesUser || touchesPhone) {
    txn.delete(k);
    deleted++;
  }
}
const res = await txn.commit();
console.log("deleted keys:", deleted, "ok:", res.ok);
kv.close();
