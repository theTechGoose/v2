import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9096;

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

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(PORT); } finally {
    await server.stop();
    await resetKv();
  }
}

Deno.test("reference e2e: create + list returns the row", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const created = await fetch(`http://localhost:${port}/profile/references`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ contactName: "Tom Smith", phoneNumber: "555-1234", jobDescription: "Roof tear-off, 2024" }),
    }).then((r) => r.json());
    assertEquals(created.contactName, "Tom Smith");
    assert(typeof created.id === "string");

    const list = await fetch(`http://localhost:${port}/profile/references`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(list.length, 1);
    assertEquals(list[0].contactName, "Tom Smith");
  });
});

Deno.test("reference e2e: update mutates the named fields and preserves the others", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const created = await fetch(`http://localhost:${port}/profile/references`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ contactName: "Tom Smith", phoneNumber: "555-1234" }),
    }).then((r) => r.json());

    const updated = await fetch(`http://localhost:${port}/profile/references/${created.id}`, {
      method: "PUT", headers: auth, body: JSON.stringify({ jobDescription: "Garage epoxy" }),
    }).then((r) => r.json());

    assertEquals(updated.jobDescription, "Garage epoxy");
    assertEquals(updated.contactName, "Tom Smith");        // preserved
    assertEquals(updated.phoneNumber, "555-1234");          // preserved
  });
});

Deno.test("reference e2e: delete removes the row from the list", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const created = await fetch(`http://localhost:${port}/profile/references`, {
      method: "POST", headers: auth, body: JSON.stringify({ contactName: "Doomed Ref" }),
    }).then((r) => r.json());

    const del = await fetch(`http://localhost:${port}/profile/references/${created.id}`, {
      method: "DELETE", headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(del, { ok: true });

    const list = await fetch(`http://localhost:${port}/profile/references`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(list.length, 0);
  });
});

Deno.test("reference e2e: A's references and B's references are isolated", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");

    await drain(await fetch(`http://localhost:${port}/profile/references`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ contactName: "A's Reference" }),
    }));

    const aList = await fetch(`http://localhost:${port}/profile/references`, { headers: { "x-session-id": sidA } }).then((r) => r.json());
    const bList = await fetch(`http://localhost:${port}/profile/references`, { headers: { "x-session-id": sidB } }).then((r) => r.json());
    assertEquals(aList.length, 1);
    assertEquals(bList.length, 0);
  });
});

Deno.test("reference e2e: cross-user UPDATE on B's id is rejected", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");

    const bRef = await fetch(`http://localhost:${port}/profile/references`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidB },
      body: JSON.stringify({ contactName: "B's Reference" }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${port}/profile/references/${bRef.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ contactName: "stolen" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("reference e2e: unauthenticated GET is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/profile/references`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("reference e2e: validation rejects missing contactName", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/profile/references`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({}),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});
