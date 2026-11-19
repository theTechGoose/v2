/**
 * REQ-1008 (LOOP-007 q1, q1-94) — two foreman powers, one answer. The account-wide role
 * (REQ-138/141, `role: "foreman"`: every crew's visits) and a crew lead (REQ-840,
 * `Crew.foremanId`: their own crew's visits only) must be told apart by GET /field/worker/me, so
 * the /worker chip can name the power the person really has. Today both come back as
 * `role: "foreman"` with nothing else that differs.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertNotEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 41008;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; headers: Headers };

Deno.test("REQ-1008 (q1-94): GET /field/worker/me tells the account-wide foreman and a crew lead apart", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const call = async (method: string, path: string, body?: unknown, headers: HeadersInit = {}): Promise<Res> => {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: { ...J, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch { /* raw */ }
    return { status: r.status, body: parsed, headers: r.headers };
  };
  try {
    const phone = "+15125551008";
    await call("POST", "/auth/send-otp", { phoneNumber: phone });
    const stored = await new OtpStore().get(phone);
    const v = await call("POST", "/auth/verify-otp", { phoneNumber: phone, code: stored!.code });
    const H = { "x-session-id": v.body.sessionId as string };
    await call("PUT", "/me", { name: "Foreman Owner", language: "en" }, H);

    const mk = async (name: string, cell: string, role?: string) => {
      const r = await call("POST", "/field/workers", { name, phoneNumber: cell, pin: "1234", ...(role ? { role } : {}) }, H);
      assertEquals(r.status, 201, JSON.stringify(r.body));
      return r.body;
    };
    await mk("Sam", "8435551081", "foreman"); // account-wide
    const ana = await mk("Ana", "8435551082"); // leads her crew
    const luis = await mk("Luis", "8435551083");
    const crew = await call("POST", "/field/crews", { name: "Grass crew", memberIds: [ana.id, luis.id], foremanId: ana.id }, H);
    assertEquals(crew.body?.foremanId, ana.id, JSON.stringify(crew.body));

    const meOf = async (cell: string) => {
      const wl = await call("POST", "/field/worker/login", { phoneNumber: cell, pin: "1234" });
      assertEquals(wl.status, 200, JSON.stringify(wl.body));
      const W = { cookie: wl.headers.get("set-cookie")!.split(";")[0] };
      const me = await call("GET", "/field/worker/me", undefined, W);
      assertEquals(me.status, 200);
      return me.body as Record<string, unknown>;
    };
    /** what /me says about the person's power — everything but who they are and their crew's name */
    const power = (me: Record<string, unknown>) => {
      const { id: _id, name: _n, language: _l, crewId: _c, crewName: _cn, ...rest } = me;
      return rest;
    };
    const sam = await meOf("8435551081");
    const anaMe = await meOf("8435551082");
    const luisMe = await meOf("8435551083");
    assert(sam.role === "foreman", `the account-wide foreman keeps role "foreman" (${JSON.stringify(sam)})`);
    assertEquals(luisMe.role, "worker", "a plain crew member is a worker");
    assertNotEquals(
      power(anaMe),
      power(sam),
      "a crew lead (own crew only) must not read the same as the account-wide foreman (every crew)",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
