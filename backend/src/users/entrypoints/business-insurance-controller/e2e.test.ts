import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9064;

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

Deno.test("business-insurance e2e: GET returns null for fresh user", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/profile/insurance`, {
      headers: { "x-session-id": sid },
    });
    assertEquals(await res.json(), null);
  });
});

Deno.test("business-insurance e2e: PUT then GET returns the saved insurance", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const created = await fetch(`http://localhost:${port}/profile/insurance`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        provider: "Hartford",
        policyNumber: "POL-1234",
        coverageCents: 100_000_000,        // $1M coverage
        expiresAt: "2027-04-01",
      }),
    }).then((r) => r.json());
    assertEquals(created.provider, "Hartford");
    assertEquals(created.policyNumber, "POL-1234");
    assertEquals(created.coverageCents, 100_000_000);
    assertEquals(created.expiresAt, "2027-04-01");

    const got = await fetch(`http://localhost:${port}/profile/insurance`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(got.provider, "Hartford");
    assertEquals(got.coverageCents, 100_000_000);
  });
});

Deno.test("business-insurance e2e: PUT merges instead of overwriting", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    await drain(await fetch(`http://localhost:${port}/profile/insurance`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ provider: "Hartford", policyNumber: "POL-1234" }),
    }));
    const merged = await fetch(`http://localhost:${port}/profile/insurance`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ coverageCents: 50_000_000 }),
    }).then((r) => r.json());
    assertEquals(merged.provider, "Hartford");      // preserved
    assertEquals(merged.policyNumber, "POL-1234");  // preserved
    assertEquals(merged.coverageCents, 50_000_000); // added
  });
});

Deno.test("business-insurance e2e: PUT rejects negative coverageCents", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/profile/insurance`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ coverageCents: -1 }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("business-insurance e2e: PUT rejects non-integer coverageCents", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/profile/insurance`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ coverageCents: 1.5 }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("business-insurance e2e: GET without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/profile/insurance`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("business-insurance e2e: PUT without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/profile/insurance`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "Hartford" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("business-insurance e2e: per-user isolation — A's data invisible to B", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    await drain(await fetch(`http://localhost:${port}/profile/insurance`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ provider: "Hartford", policyNumber: "POL-A" }),
    }));
    const bData = await fetch(`http://localhost:${port}/profile/insurance`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bData, null);
  });
});

// REQ-503 (demo-loop cycle 3, demo m62): onboarding saved insurer "!!!" and a
// 120-character policy number. The DTO now refuses both shapes.
async function putInsurance(port: number, sid: string, body: unknown) {
  const res = await fetch(`http://localhost:${port}/profile/insurance`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify(body),
  });
  const ok = res.ok;
  await drain(res);
  return ok;
}

Deno.test("REQ-503 m62 business-insurance e2e: PUT refuses insurer '!!!' and a 120-char policy number, nothing is saved", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    assertEquals(await putInsurance(port, sid, { provider: "!!!" }), false, "insurer !!!");
    assertEquals(await putInsurance(port, sid, { provider: "A" }), false, "one-letter insurer");
    assertEquals(await putInsurance(port, sid, { provider: "x".repeat(81) }), false, "81-char insurer");
    assertEquals(
      await putInsurance(port, sid, { provider: "State Farm", policyNumber: "1".repeat(120) }),
      false,
      "120-char policy number",
    );
    assertEquals(
      await putInsurance(port, sid, { provider: "State Farm", policyNumber: "POL#1234" }),
      false,
      "policy number with #",
    );
    const got = await fetch(`http://localhost:${port}/profile/insurance`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(got, null, "nothing was stored");
  });
});

Deno.test("REQ-503 m62 business-insurance e2e: a real insurer and policy number save; a blank one clears", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    assertEquals(
      await putInsurance(port, sid, { provider: "AT&T Insurance Co.", policyNumber: "HX-2024-0099" }),
      true,
    );
    assertEquals(await putInsurance(port, sid, { provider: "Mapfre España" }), true);
    // Settings clears a field by saving it blank
    assertEquals(await putInsurance(port, sid, { policyNumber: "" }), true);
    const got = await fetch(`http://localhost:${port}/profile/insurance`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(got.provider, "Mapfre España");
    assertEquals(got.policyNumber, "");
  });
});
