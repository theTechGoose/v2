/**
 * REQ-1043 (LOOP-007 cycle 2, q2-27) — PUT /profile/identity stored any string as websiteUrl
 * (UpdateBusinessIdentityDto.websiteUrl was @IsOptional @IsString only), and the public quote /
 * invoice projections handed it to the customer as a link. "https://reyes tile dot com" is not a
 * URL: the server must answer 400 and keep the previous website; a blank value still clears it.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { FilesModule } from "@files/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, FilesModule] })
class TestApp {}

const PORT = 9000 + Math.floor(Math.random() * 900) + 41;

async function withServer(fn: (base: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(`http://localhost:${PORT}`);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(base: string, phone: string): Promise<string> {
  await (await fetch(`${base}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function put(base: string, sid: string, body: unknown) {
  const r = await fetch(`${base}/profile/identity`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify(body),
  });
  await r.body?.cancel();
  return r.status;
}

async function storedSite(base: string, sid: string): Promise<unknown> {
  const r = await fetch(`${base}/profile/identity`, {
    headers: { "x-session-id": sid },
  });
  return (await r.json())?.websiteUrl;
}

Deno.test("REQ-1043 q2-27: PUT /profile/identity refuses a junk website with 400 and keeps the previous one", async () => {
  await withServer(async (base) => {
    const sid = await login(base, "+15125550427");
    assertEquals(
      await put(base, sid, { businessName: "Reyes Tile", websiteUrl: "https://reyestile.com" }),
      200,
      "a real website saves",
    );
    for (const junk of ["https://reyes tile dot com", "reyes tile dot com", "https://asdf", "http://"]) {
      assertEquals(
        { junk, status: await put(base, sid, { websiteUrl: junk }) },
        { junk, status: 400 },
        `PUT websiteUrl=${JSON.stringify(junk)} must be refused`,
      );
      assertEquals(
        { junk, stored: await storedSite(base, sid) },
        { junk, stored: "https://reyestile.com" },
        "the previous website is kept",
      );
    }
    // blank still clears it
    assertEquals(await put(base, sid, { websiteUrl: "" }), 200, "blank clears");
    assertEquals(await storedSite(base, sid) ?? "", "", "cleared");
  });
});
