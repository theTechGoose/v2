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

const PORT = 9092;

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

// ---------------- /quotes (enriched) ----------------

Deno.test("quotes e2e: GET /quotes returns QuoteCard[] with stage", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "Roof", lineItems: [] }),
    }).then(drain);

    const cards = await fetch(`http://localhost:${port}/quotes`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(cards.length, 1);
    assertEquals(cards[0].stage, "draft");
    assert(typeof cards[0].opens === "number");
    assert(typeof cards[0].daysIn === "number");
  });
});

Deno.test("quotes e2e: GET /quotes?status=draft still filters", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "A", lineItems: [], status: "draft" }),
    }).then(drain);
    // stage filter (status param now means stage)
    const filtered = await fetch(`http://localhost:${port}/quotes?status=draft`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(filtered.length, 1);
    assertEquals(filtered[0].stage, "draft");

    // other stages should return empty
    const sentOnly = await fetch(`http://localhost:${port}/quotes?status=sent`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(sentOnly, []);
  });
});

Deno.test("quotes e2e: GET /quotes without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/quotes`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("quotes e2e: GET /quotes scopes by owner", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const authA = { "content-type": "application/json", "x-session-id": sidA };
    await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: authA, body: JSON.stringify({ summary: "A's", lineItems: [] }),
    }).then(drain);
    const bCards = await fetch(`http://localhost:${port}/quotes`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bCards, []);
  });
});

// ---------------- /quotes/:id/opens ----------------

Deno.test("quotes e2e: GET /quotes/:id/opens happy path", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const q = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "Roof", lineItems: [] }),
    }).then((r) => r.json());

    // Public POST /views
    const vBody = {
      paperworkType: "quote",
      paperworkId:   q.id,
      viewedAt:      new Date().toISOString(),
      userAgent:     "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari",
      durationMs:    8_500,
    };
    await fetch(`http://localhost:${port}/views`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(vBody),
    }).then(drain);

    const out = await fetch(`http://localhost:${port}/quotes/${q.id}/opens`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(out.opens.length, 1);
    assertEquals(out.opens[0].device, "mobile");
    assertEquals(out.opens[0].durationMs, 8_500);
    assert(typeof out.opens[0].atRel === "string");
  });
});

Deno.test("quotes e2e: GET /quotes/:id/opens by another user is rejected", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const q = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ summary: "A's", lineItems: [] }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${port}/quotes/${q.id}/opens`, {
      headers: { "x-session-id": sidB },
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("quotes e2e: GET /quotes/:id/opens without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/quotes/anything/opens`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

// ---------------- /analytics/quotes/win-rate ----------------

Deno.test("quotes e2e: GET /analytics/quotes/win-rate happy path (50%)", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const q1 = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "won", lineItems: [] }),
    }).then((r) => r.json());
    await fetch(`http://localhost:${port}/quotes/${q1.id}`, {
      method: "PUT", headers: auth, body: JSON.stringify({ acceptedAt: new Date().toISOString() }),
    }).then(drain);
    const q2 = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "lost", lineItems: [] }),
    }).then((r) => r.json());
    await fetch(`http://localhost:${port}/quotes/${q2.id}`, {
      method: "PUT", headers: auth, body: JSON.stringify({ lostAt: new Date().toISOString() }),
    }).then(drain);

    const out = await fetch(`http://localhost:${port}/analytics/quotes/win-rate?days=90`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(out.windowDays, 90);
    assertEquals(out.decided, 2);
    assertEquals(out.won, 1);
    assertEquals(out.lost, 1);
    assertEquals(out.winRate, 50);
  });
});

Deno.test("quotes e2e: GET /analytics/quotes/win-rate without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/analytics/quotes/win-rate`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("quotes e2e: GET /analytics/quotes/win-rate scopes by owner", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const authA = { "content-type": "application/json", "x-session-id": sidA };
    const q = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: authA, body: JSON.stringify({ summary: "A's", lineItems: [] }),
    }).then((r) => r.json());
    await fetch(`http://localhost:${port}/quotes/${q.id}`, {
      method: "PUT", headers: authA, body: JSON.stringify({ acceptedAt: new Date().toISOString() }),
    }).then(drain);
    const out = await fetch(`http://localhost:${port}/analytics/quotes/win-rate`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(out.decided, 0);
    assertEquals(out.winRate, null);
  });
});

Deno.test("quotes e2e: GET /analytics/quotes/win-rate shape contract", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const out = await fetch(`http://localhost:${port}/analytics/quotes/win-rate`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assert(typeof out.windowDays === "number");
    assert(typeof out.decided === "number");
    assert(typeof out.won === "number");
    assert(typeof out.lost === "number");
    assert(out.winRate === null || typeof out.winRate === "number");
  });
});

// ---------------- /analytics/quotes/insight ----------------

Deno.test("quotes e2e: GET /analytics/quotes/insight returns static_fallback for fresh user", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const out = await fetch(`http://localhost:${port}/analytics/quotes/insight`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(out.kind, "static_fallback");
    assert(out.text.length > 0);
  });
});

Deno.test("quotes e2e: GET /analytics/quotes/insight without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/analytics/quotes/insight`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});
