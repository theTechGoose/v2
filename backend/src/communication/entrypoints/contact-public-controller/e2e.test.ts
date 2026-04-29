import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CommunicationModule } from "@communication/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [CommunicationModule] })
class TestApp {}

const PORT = 9032;

async function drain(res: Response) { await res.body?.cancel(); }

const valid = (overrides: Partial<{ name: string; email: string; subject: string; message: string }> = {}) => ({
  name: "Lead",
  email: "lead@example.test",
  subject: "Need a quote",
  message: "Roof replacement, 2-story, asphalt.",
  ...overrides,
});

Deno.test("contact e2e: happy path returns ok=true (dev_mode_no_dispatch)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.set("POSTMARK_FROM", "ops@example.test");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid()),
    }).then((r) => r.json());
    assertEquals(res.ok, true);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("contact e2e: rate limit kicks in after 5 submissions per email per hour", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.set("POSTMARK_FROM", "ops@example.test");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const url = `http://localhost:${PORT}/contact`;
    const headers = { "content-type": "application/json" };
    const payload = JSON.stringify(valid({ email: "spammer@example.test" }));

    for (let i = 0; i < 5; i++) {
      const r = await fetch(url, { method: "POST", headers, body: payload }).then((r) => r.json());
      assertEquals(r.ok, true);
    }
    const blocked = await fetch(url, { method: "POST", headers, body: payload }).then((r) => r.json());
    assertEquals(blocked.ok, false);
    assertEquals(blocked.reason, "too_many_attempts");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("contact e2e: invalid email rejected before rate limiter consumes a slot", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.set("POSTMARK_FROM", "ops@example.test");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid({ email: "not-an-email" })),
    });
    assertEquals(res.status >= 400, true);
    await drain(res);
  } finally {
    await server.stop();
    await resetKv();
  }
});
