import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9014;

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

Deno.test("invoice e2e: DELETE removes the invoice for owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const created = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ contractId: "c-1", dueDate: "2026-05-01" }),
    }).then((r) => r.json());

    const del = await fetch(`http://localhost:${PORT}/invoices/${created.id}`, {
      method: "DELETE",
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(del.ok, true);

    const list = await fetch(`http://localhost:${PORT}/invoices`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(list.length, 0);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("invoice e2e: GET ?status=pending filters", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ contractId: "c-1", dueDate: "2026-05-01", status: "pending" }),
    }));
    await drain(await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ contractId: "c-1", dueDate: "2026-05-02", status: "paid" }),
    }));
    const pending = await fetch(`http://localhost:${PORT}/invoices?status=pending`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(pending.length, 1);
    assertEquals(pending[0].status, "pending");
  } finally {
    await server.stop();
    await resetKv();
  }
});

// REQ-473 (demo-loop cycle 3, issue M8): the dashboard's Outstanding list
// asked for ?status=pending — a legacy status accept never writes — so it was
// always empty. ?status=open lists the open receivables (the REQ-397 rule).
Deno.test("REQ-473 invoice e2e: GET ?status=open lists sent/viewed/claimed/pending invoices with a balance — never scheduled, draft, paid or void", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    for (const status of ["sent", "viewed", "claimed", "pending", "scheduled", "draft", "paid", "void"]) {
      await drain(await fetch(`http://localhost:${PORT}/invoices`, {
        method: "POST", headers: auth,
        body: JSON.stringify({ dueDate: "2026-05-01", status, amount: 925_00, jobName: status }),
      }));
    }
    const open = await fetch(`http://localhost:${PORT}/invoices?status=open`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(
      (open as { status: string }[]).map((i) => i.status).sort(),
      ["claimed", "pending", "sent", "viewed"],
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
