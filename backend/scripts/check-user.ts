import { getKv } from "../src/core/data/kv/mod.ts";
const kv = await getKv();
const idx = await kv.get(["user_by_phone", "+18438557133"]);
console.log("index for +18438557133:", idx.value);
kv.close();
