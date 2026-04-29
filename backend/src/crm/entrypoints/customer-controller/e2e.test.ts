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

const PORT = 9011;

async function drain(res: Response) { await res.body?.cancel(); }

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

Deno.test("customer e2e: POST then GET round-trip for the rightful owner", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const created = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Acme" }),
    }).then((r) => r.json());
    assertEquals(created.name, "Acme");

    const fetched = await fetch(`http://localhost:${port}/customers/${created.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(fetched.id, created.id);
  });
});

Deno.test("customer e2e: POST without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("customer e2e: GET list scopes by owner — A's customers invisible to B", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    await drain(await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "A's customer" }),
    }));
    const bList = await fetch(`http://localhost:${port}/customers`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bList, []);
  });
});

Deno.test("customer e2e: GET /:id by another user is rejected (403)", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const created = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "A's customer" }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${port}/customers/${created.id}`, {
      headers: { "x-session-id": sidB },
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("customer e2e: POST /customers accepts segment + vip", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const created = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Acme HOA", segment: "hoa", vip: true }),
    }).then((r) => r.json());
    assertEquals(created.segment, "hoa");
    assertEquals(created.vip, true);
  });
});

Deno.test("customer e2e: PUT /customers/:id updates segment + vip", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const created = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Acme" }),
    }).then((r) => r.json());

    const updated = await fetch(`http://localhost:${port}/customers/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ segment: "property_mgmt", vip: true }),
    }).then((r) => r.json());
    assertEquals(updated.segment, "property_mgmt");
    assertEquals(updated.vip, true);
  });
});

Deno.test("customer e2e: POST /customers rejects invalid segment", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Bad", segment: "not_a_real_segment" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("customer e2e: PUT/DELETE by another user are rejected", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const created = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "A's customer" }),
    }).then((r) => r.json());

    const put = await fetch(`http://localhost:${port}/customers/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sidB },
      body: JSON.stringify({ name: "hacked" }),
    });
    assertEquals(put.ok, false);
    await drain(put);

    const del = await fetch(`http://localhost:${port}/customers/${created.id}`, {
      method: "DELETE",
      headers: { "x-session-id": sidB },
    });
    assertEquals(del.ok, false);
    await drain(del);
  });
});
