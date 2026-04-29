import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9063;

async function drain(res: Response): Promise<void> {
  await res.body?.cancel();
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

Deno.test("business-address e2e: GET returns null for fresh user", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/profile/address`, {
      headers: { "x-session-id": sid },
    });
    assertEquals(await res.json(), null);
  });
});

Deno.test("business-address e2e: PUT then GET returns the saved address", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const created = await fetch(`http://localhost:${port}/profile/address`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        street: "123 Main St",
        city: "Austin",
        state: "TX",
        postal: "78701",
        country: "US",
      }),
    }).then((r) => r.json());
    assertEquals(created.street, "123 Main St");
    assertEquals(created.city, "Austin");
    assertEquals(created.state, "TX");

    const got = await fetch(`http://localhost:${port}/profile/address`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(got.street, "123 Main St");
    assertEquals(got.postal, "78701");
  });
});

Deno.test("business-address e2e: PUT merges instead of overwriting", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    await drain(await fetch(`http://localhost:${port}/profile/address`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ street: "123 Main St", city: "Austin", state: "TX" }),
    }));
    const merged = await fetch(`http://localhost:${port}/profile/address`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ postal: "78701" }),
    }).then((r) => r.json());
    assertEquals(merged.street, "123 Main St");   // preserved
    assertEquals(merged.city, "Austin");           // preserved
    assertEquals(merged.state, "TX");              // preserved
    assertEquals(merged.postal, "78701");          // added
  });
});

Deno.test("business-address e2e: PUT rejects non-string field types", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/profile/address`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ street: 12345 }),  // not a string
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("business-address e2e: GET without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/profile/address`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("business-address e2e: PUT without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/profile/address`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ city: "Austin" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("business-address e2e: per-user isolation — A's data invisible to B", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    await drain(await fetch(`http://localhost:${port}/profile/address`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ street: "123 Main", city: "Austin" }),
    }));
    const bData = await fetch(`http://localhost:${port}/profile/address`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bData, null);
  });
});
