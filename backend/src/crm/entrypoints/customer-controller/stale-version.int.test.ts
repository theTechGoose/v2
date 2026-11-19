/**
 * REQ-1144 (LOOP-007 cycle 3, q3-74) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green". QA: two tabs
 * editing the same customer — the last save silently wins (version not
 * enforced).
 *
 * Integration over HTTP, app booted, KV :memory:. A customer reads version 1;
 * PUT {notes:"A", version:1} → 200 and version 2; a second PUT still at
 * version 1 is refused 409 {error:"stale_version", currentVersion:2,
 * customer} and changes nothing. Two concurrent PUTs at the same version:
 * exactly one wins.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function login(phone: string): Promise<string> {
  const sent = await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  });
  await sent.body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function boot() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const sid = await login(`+1512555${Math.floor(1000 + Math.random() * 8999)}`);
  const headers = { "content-type": "application/json", "x-session-id": sid };
  const created = await fetch(`${BASE}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Rosa Delgado",
      phoneNumber: "+18435550111",
      notes: "original",
    }),
  }).then((r) => r.json());
  const put = (body: unknown) =>
    fetch(`${BASE}/customers/${created.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
  const read = () =>
    fetch(`${BASE}/customers/${created.id}`, { headers }).then((r) => r.json());
  return { server, created, put, read };
}

Deno.test("REQ-1144 (LOOP-007 q3, q3-74): a save at a stale version is refused 409 stale_version and the newer edit is kept", async () => {
  const { server, put, read } = await boot();
  try {
    const loaded = await read();
    assertEquals(loaded.version, 1, "a new customer reads version 1");

    // tab A saves at the version it loaded
    const a = await put({ notes: "tab A note", version: 1 });
    const aBody = await a.json();
    assertEquals(a.status, 200, JSON.stringify(aBody));
    assertEquals(aBody.notes, "tab A note");
    assertEquals(aBody.version, 2, "a successful edit bumps the version");

    // tab B still holds version 1 — its save must not silently win
    const b = await put({ notes: "tab B note", version: 1 });
    const bBody = await b.json().catch(() => null);
    assertEquals(
      b.status,
      409,
      `a save at a stale version is refused (got ${b.status} ${
        JSON.stringify(bBody)
      })`,
    );
    assertEquals(bBody?.error, "stale_version", JSON.stringify(bBody));
    assertEquals(bBody?.currentVersion, 2, JSON.stringify(bBody));
    assertEquals(
      bBody?.customer?.notes,
      "tab A note",
      "the 409 carries the latest customer",
    );

    const after = await read();
    assertEquals(after.notes, "tab A note", "the stale save changed nothing");
    assertEquals(after.version, 2);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-1144 (LOOP-007 q3, q3-74): two concurrent saves at the same version — exactly one wins, the other is 409", async () => {
  const { server, put, read } = await boot();
  try {
    const [x, y] = await Promise.all([
      put({ notes: "tab X", version: 1 }),
      put({ notes: "tab Y", version: 1 }),
    ]);
    const xs = [x.status, y.status].sort();
    await x.body?.cancel();
    await y.body?.cancel();
    assertEquals(
      xs,
      [200, 409],
      `exactly one concurrent save at version 1 wins (got ${xs.join(", ")})`,
    );
    const after = await read();
    assertEquals(after.version, 2, "one edit landed, one version bump");
  } finally {
    await server.stop();
    await resetKv();
  }
});
