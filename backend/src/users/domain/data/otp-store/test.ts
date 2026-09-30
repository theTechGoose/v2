import { assertEquals } from "#std/assert";
import { OtpStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("otp-store smoke: put then get returns the record", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new OtpStore();
  await store.put({ phoneNumber: "+15125551234", code: "123456", language: "es" });
  const fetched = await store.get("+15125551234");
  assertEquals(fetched?.code, "123456");
  assertEquals(fetched?.language, "es");
  assertEquals(fetched?.attempts, 0);
  await resetKv();
});

Deno.test("otp-store smoke: get on missing phone returns null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new OtpStore();
  assertEquals(await store.get("+10000000000"), null);
  await resetKv();
});

Deno.test("otp-store smoke: recordAttempt increments the counter", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new OtpStore();
  await store.put({ phoneNumber: "+15125551234", code: "123456" });
  const after1 = await store.recordAttempt("+15125551234");
  assertEquals(after1?.attempts, 1);
  const after2 = await store.recordAttempt("+15125551234");
  assertEquals(after2?.attempts, 2);
  await resetKv();
});

Deno.test("otp-store smoke: recordAttempt on missing phone returns null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new OtpStore();
  assertEquals(await store.recordAttempt("+10000000000"), null);
  await resetKv();
});

Deno.test("otp-store smoke: clear removes the record", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new OtpStore();
  await store.put({ phoneNumber: "+15125551234", code: "123456" });
  await store.clear("+15125551234");
  assertEquals(await store.get("+15125551234"), null);
  await resetKv();
});

Deno.test("otp-store smoke: re-put rotates the code without leaking the old one", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new OtpStore();
  await store.put({ phoneNumber: "+15125551234", code: "111111" });
  await store.put({ phoneNumber: "+15125551234", code: "222222" });
  const fetched = await store.get("+15125551234");
  assertEquals(fetched?.code, "222222");
  assertEquals(fetched?.attempts, 0);     // counter reset on re-send
  await resetKv();
});
