import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FilesModule } from "@files/mod-root.ts";
import { MAX_UPLOAD_BYTES } from "./mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [FilesModule] })
class TestApp {}

const PORT = 9097;

async function drain(res: Response) { await res.body?.cancel(); }

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Base64-encode raw bytes in chunks (btoa chokes on huge binary strings). */
function b64Bytes(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

Deno.test("files e2e: POST then GET binary round-trip", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const meta = await fetch(`http://localhost:${PORT}/files`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ filename: "hi.txt", mimeType: "text/plain", base64: b64("hello world") }),
    }).then((r) => r.json());
    assertEquals(meta.sizeBytes, 11);
    assertEquals(meta.filename, "hi.txt");

    const dl = await fetch(`http://localhost:${PORT}/files/${meta.id}`, {
      headers: { "x-session-id": sid },
    });
    assertEquals(dl.headers.get("content-type"), "text/plain");
    assertEquals(await dl.text(), "hello world");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("files e2e: GET /files lists the user's uploads", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(await fetch(`http://localhost:${PORT}/files`, { method: "POST", headers: auth, body: JSON.stringify({ filename: "a", mimeType: "text/plain", base64: b64("a") }) }));
    await drain(await fetch(`http://localhost:${PORT}/files`, { method: "POST", headers: auth, body: JSON.stringify({ filename: "b", mimeType: "text/plain", base64: b64("b") }) }));
    const list = await fetch(`http://localhost:${PORT}/files`, { headers: { "x-session-id": sid } }).then((r) => r.json());
    assertEquals(list.length, 2);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("files e2e: cross-user download is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const meta = await fetch(`http://localhost:${PORT}/files`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ filename: "secret.txt", mimeType: "text/plain", base64: b64("classified") }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${PORT}/files/${meta.id}`, {
      headers: { "x-session-id": sidB },
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("files e2e: DELETE removes the file", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const meta = await fetch(`http://localhost:${PORT}/files`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ filename: "x.txt", mimeType: "text/plain", base64: b64("x") }),
    }).then((r) => r.json());

    const del = await fetch(`http://localhost:${PORT}/files/${meta.id}`, {
      method: "DELETE",
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(del.ok, true);

    const list = await fetch(`http://localhost:${PORT}/files`, { headers: { "x-session-id": sid } }).then((r) => r.json());
    assertEquals(list, []);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("files e2e: >1MB upload round-trips through POST then GET", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const bytes = new Uint8Array(1_500_000); // ~1.5MB → multiple commit batches
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) & 0xff;
    const meta = await fetch(`http://localhost:${PORT}/files`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ filename: "big.bin", mimeType: "application/octet-stream", base64: b64Bytes(bytes) }),
    }).then((r) => r.json());
    assertEquals(meta.sizeBytes, bytes.length);

    const dl = await fetch(`http://localhost:${PORT}/files/${meta.id}`, { headers: { "x-session-id": sid } });
    const back = new Uint8Array(await dl.arrayBuffer());
    assertEquals(back, bytes);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("files e2e: oversized upload is rejected with 413, not a 500", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1024); // just over the cap
    const res = await fetch(`http://localhost:${PORT}/files`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ filename: "huge.bin", mimeType: "application/octet-stream", base64: b64Bytes(bytes) }),
    });
    assertEquals(res.status, 413);
    const body = await res.json();
    assertEquals(body.code, "file_too_large");
    assertEquals(body.maxBytes, MAX_UPLOAD_BYTES);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("files e2e: POST without session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "x", mimeType: "text/plain", base64: b64("x") }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});
