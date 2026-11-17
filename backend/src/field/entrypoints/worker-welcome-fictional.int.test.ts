/**
 * REQ-523 (demo-loop cycle 3, issue m16): pair 2 added the worker Luis Gómez
 * at (305) 555-0123 — a fictional 555-01XX number — and /field/workers said
 * "Le mandamos a Luis Gómez el enlace para entrar y su PIN por texto." The
 * welcome text went through SmsService.send unguarded, and in dev mode that
 * answered ok for any number, so the add answered `texted: true`.
 *
 * Over HTTP, app booted, the REAL SmsService in dev mode (no
 * TWILIO_ACCOUNT_SID — what the demo ran on).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const J = { "content-type": "application/json" };

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  // deno-lint-ignore no-explicit-any
): Promise<{ status: number; body: any }> {
  const r = await fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: { ...J, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

Deno.test("REQ-523 (m16) adding a worker at a fictional 555-01XX number answers texted:false; a real number answers texted:true", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const owner = "+15125552311";
    await call("POST", "/auth/send-otp", { phoneNumber: owner });
    const code = (await new OtpStore().get(owner))!.code;
    const v = await call("POST", "/auth/verify-otp", {
      phoneNumber: owner,
      code,
    });
    const H = { "x-session-id": v.body.sessionId as string };
    await call("PUT", "/me", { name: "Marco Ruiz", language: "es" }, H);

    // pair 2's exact worker
    const luis = await call("POST", "/field/workers", {
      name: "Luis Gómez",
      phoneNumber: "(305) 555-0123",
      pin: "1234",
    }, H);
    assertEquals(luis.status, 201, JSON.stringify(luis.body));
    assertEquals(
      luis.body.texted,
      false,
      "the add claimed the PIN was texted to a number that cannot get texts",
    );

    const ana = await call("POST", "/field/workers", {
      name: "Ana Ríos",
      phoneNumber: "(305) 555-1234",
      pin: "4321",
    }, H);
    assertEquals(ana.status, 201, JSON.stringify(ana.body));
    assertEquals(ana.body.texted, true, "a real number is texted");
  } finally {
    await server.stop();
    await resetKv();
  }
});
