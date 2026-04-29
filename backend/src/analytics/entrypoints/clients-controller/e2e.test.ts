import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 9091;

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

// ---------------- /clients ----------------

Deno.test("clients e2e: GET /clients returns CustomerCard[] with derived fields", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const c = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Acme HOA", segment: "hoa", vip: true }),
    }).then((r) => r.json());

    const cards = await fetch(`http://localhost:${port}/clients`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(cards.length, 1);
    const card = cards[0];
    assertEquals(card.id, c.id);
    assertEquals(card.name, "Acme HOA");
    assertEquals(card.vip, true);
    assertEquals(card.segment, "hoa");
    // Derived fields present
    assert(typeof card.status === "string");
    assert(typeof card.temp === "number");
    assert(typeof card.balanceCents === "number");
    assert(typeof card.daysSinceContact === "number");
    assert(typeof card.lastWhenRel === "string");
  });
});

Deno.test("clients e2e: GET /clients without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/clients`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("clients e2e: GET /clients scopes by owner", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    await drain(await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "A's customer" }),
    }));
    const bCards = await fetch(`http://localhost:${port}/clients`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bCards, []);
  });
});

Deno.test("clients e2e: GET /clients spot-checks status==='owes' end-to-end (pending invoice)", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const c = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Owes Co" }),
    }).then((r) => r.json());

    // Need a contract to satisfy invoice DTO; cheat by passing contractId as a string
    await fetch(`http://localhost:${port}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        contractId: "ghost-contract",
        customerId: c.id,
        dueDate: "2026-04-01",
        status: "pending",
        amount: 250,
      }),
    }).then((r) => r.json());

    const cards = await fetch(`http://localhost:${port}/clients`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(cards[0].status, "owes");
    assertEquals(cards[0].balanceCents, 250_00);
  });
});

// ---------------- /analytics/clients/top ----------------

Deno.test("clients e2e: GET /analytics/clients/top happy path", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const c1 = await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Big" }),
    }).then((r) => r.json());
    const c2 = await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Small" }),
    }).then((r) => r.json());

    const now = new Date().toISOString();
    await fetch(`http://localhost:${port}/invoices`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ contractId: "k", customerId: c1.id, dueDate: "2026-04-01", status: "paid", amount: 1000, paidAt: now }),
    }).then(drain);
    await fetch(`http://localhost:${port}/invoices`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ contractId: "k", customerId: c2.id, dueDate: "2026-04-01", status: "paid", amount: 250, paidAt: now }),
    }).then(drain);

    const out = await fetch(`http://localhost:${port}/analytics/clients/top?limit=5`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(out.results.length, 2);
    assertEquals(out.results[0].customerId, c1.id);
    assertEquals(out.results[0].rank, 1);
    assertEquals(out.results[0].barPct, 100);
    assertEquals(out.results[1].customerId, c2.id);
    assertEquals(out.results[1].rank, 2);
    assertEquals(out.results[1].barPct, 25);
  });
});

Deno.test("clients e2e: GET /analytics/clients/top without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/analytics/clients/top`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("clients e2e: GET /analytics/clients/top scopes by owner", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const cA = await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "A's" }),
    }).then((r) => r.json());
    const now = new Date().toISOString();
    await fetch(`http://localhost:${port}/invoices`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ contractId: "k", customerId: cA.id, dueDate: "2026-04-01", status: "paid", amount: 999, paidAt: now }),
    }).then(drain);
    const bResults = await fetch(`http://localhost:${port}/analytics/clients/top`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bResults.results, []);
  });
});

Deno.test("clients e2e: GET /analytics/clients/top respects limit", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const now = new Date().toISOString();
    for (let i = 0; i < 4; i++) {
      const c = await fetch(`http://localhost:${port}/customers`, {
        method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
        body: JSON.stringify({ name: `C${i}` }),
      }).then((r) => r.json());
      await fetch(`http://localhost:${port}/invoices`, {
        method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
        body: JSON.stringify({ contractId: "k", customerId: c.id, dueDate: "2026-04-01", status: "paid", amount: 100 + i, paidAt: now }),
      }).then(drain);
    }
    const out = await fetch(`http://localhost:${port}/analytics/clients/top?limit=2`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(out.results.length, 2);
  });
});

// ---------------- /analytics/clients/segments ----------------

Deno.test("clients e2e: GET /analytics/clients/segments happy path", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "PM-1", segment: "property_mgmt" }),
    }).then(drain);
    await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "PM-2", segment: "property_mgmt" }),
    }).then(drain);
    await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "HO", segment: "homeowner" }),
    }).then(drain);

    const out = await fetch(`http://localhost:${port}/analytics/clients/segments`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    const pm = out.segments.find((s: { key: string }) => s.key === "property_mgmt");
    assertEquals(pm.count, 2);
    assertEquals(pm.pct, 67);
  });
});

Deno.test("clients e2e: GET /analytics/clients/segments without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/analytics/clients/segments`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("clients e2e: GET /analytics/clients/segments shape contract", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ name: "Solo", segment: "hoa" }),
    }).then(drain);
    const out = await fetch(`http://localhost:${port}/analytics/clients/segments`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assert(Array.isArray(out.segments));
    const row = out.segments[0];
    assert(typeof row.key === "string");
    assert(typeof row.label === "string");
    assert(typeof row.count === "number");
    assert(typeof row.pct === "number");
  });
});
