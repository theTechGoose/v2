import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [PaperworkModule] })
class TestApp {}

const PORT = 9093;

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

Deno.test("paperwork-email e2e: POST /quotes/:id/email dispatches in dev mode", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme", email: "ops@acme.test" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "Roof", lineItems: [], status: "sent", estimatedTotal: 1000,
      }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${PORT}/quotes/${quote.id}/email`, {
      method: "POST", headers: auth, body: JSON.stringify({}),
    }).then((r) => r.json());
    assertEquals(res.ok, true);
    assertEquals(res.to, "ops@acme.test");
    assert(res.subject.includes("Roof"));
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("paperwork-email e2e: POST /quotes/:id/email returns ok=false when no recipient", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        summary: "Orphan", lineItems: [],
      }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${PORT}/quotes/${quote.id}/email`, {
      method: "POST", headers: auth, body: JSON.stringify({}),
    }).then((r) => r.json());
    assertEquals(res.ok, false);
    assert(res.reason.includes("no recipient"));
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("paperwork-email e2e: POST /contracts/:id/email + /invoices/:id/email dispatch", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme", email: "ops@acme.test" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "x", lineItems: [], status: "accepted",
      }),
    }).then((r) => r.json());
    const contract = await fetch(`http://localhost:${PORT}/contracts`, {
      method: "POST", headers: auth, body: JSON.stringify({
        quoteId: quote.id, customerId: customer.id, totalAmount: 1500,
      }),
    }).then((r) => r.json());
    const invoice = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST", headers: auth, body: JSON.stringify({
        contractId: contract.id, customerId: customer.id, dueDate: "2026-06-01", amount: 750,
      }),
    }).then((r) => r.json());

    const cRes = await fetch(`http://localhost:${PORT}/contracts/${contract.id}/email`, {
      method: "POST", headers: auth, body: JSON.stringify({ to: "owner@acme.test" }),
    }).then((r) => r.json());
    const iRes = await fetch(`http://localhost:${PORT}/invoices/${invoice.id}/email`, {
      method: "POST", headers: auth, body: JSON.stringify({}),
    }).then((r) => r.json());

    assertEquals(cRes.ok, true);
    assertEquals(cRes.to, "owner@acme.test");
    assertEquals(iRes.ok, true);
    assertEquals(iRes.to, "ops@acme.test");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("paperwork-email e2e: cross-tenant POST is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const authA = { "content-type": "application/json", "x-session-id": sidA };
    const authB = { "content-type": "application/json", "x-session-id": sidB };

    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: authA, body: JSON.stringify({ name: "Acme", email: "x@y.z" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: authA, body: JSON.stringify({
        customerId: customer.id, summary: "x", lineItems: [],
      }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${PORT}/quotes/${quote.id}/email`, {
      method: "POST", headers: authB, body: JSON.stringify({}),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("paperwork-email e2e: send stamps quote.sentAt + status='sent'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme", email: "ops@acme.test" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "Roof", lineItems: [], status: "draft",
      }),
    }).then((r) => r.json());
    assertEquals(quote.sentAt, undefined);

    await drain(await fetch(`http://localhost:${PORT}/quotes/${quote.id}/email`, {
      method: "POST", headers: auth, body: JSON.stringify({}),
    }));

    const after = await fetch(`http://localhost:${PORT}/quotes/${quote.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assert(typeof after.sentAt === "string" && after.sentAt.length > 0);
    assertEquals(after.status, "sent");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("paperwork-email e2e: send is idempotent on resend (sentAt unchanged)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme", email: "ops@acme.test" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "Roof", lineItems: [],
      }),
    }).then((r) => r.json());

    await drain(await fetch(`http://localhost:${PORT}/quotes/${quote.id}/email`, {
      method: "POST", headers: auth, body: JSON.stringify({}),
    }));
    const first = await fetch(`http://localhost:${PORT}/quotes/${quote.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    // Wait long enough that a re-stamp would produce a different ISO string
    await new Promise((res) => setTimeout(res, 25));

    await drain(await fetch(`http://localhost:${PORT}/quotes/${quote.id}/email`, {
      method: "POST", headers: auth, body: JSON.stringify({}),
    }));
    const second = await fetch(`http://localhost:${PORT}/quotes/${quote.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(second.sentAt, first.sentAt);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("paperwork-email e2e: unauthenticated POST rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/quotes/anything/email`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});
