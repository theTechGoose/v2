/**
 * REQ-802 — the customer card's Delete action rides DELETE /customers/:id
 * (REQ-039's soft delete): the customer answers 404 afterwards and leaves the
 * list; another account cannot delete it.
 */
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
const PORT = 9802;
const J = { "content-type": "application/json" };

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(PORT);
  } finally {
    await server.stop();
    await resetKv();
  }
}
async function login(port: number, phone: string): Promise<string> {
  await (await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-802 DELETE /customers/:id — the customer answers 404 and leaves the list; another account is refused", async () => {
  await withServer(async (port) => {
    const base = `http://localhost:${port}`;
    const sid = await login(port, "+15125558021");
    const other = await login(port, "+15125558022");
    const H = { ...J, "x-session-id": sid };
    const mk = async (name: string) =>
      (await fetch(`${base}/customers`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ name, phoneNumber: "+15125550000" }),
      })).json();
    const a = await mk("Ana Delete");
    const b = await mk("Bea Stays");

    // another account cannot delete it
    const forbidden = await fetch(`${base}/customers/${a.id}`, {
      method: "DELETE",
      headers: { ...J, "x-session-id": other },
    });
    await forbidden.body?.cancel();
    assertEquals(forbidden.status >= 400, true);
    const still = await fetch(`${base}/customers/${a.id}`, { headers: H });
    assertEquals(still.status, 200);
    await still.body?.cancel();

    // the owner deletes it
    const del = await fetch(`${base}/customers/${a.id}`, {
      method: "DELETE",
      headers: H,
    });
    assertEquals(del.status, 200);
    assertEquals(await del.json(), { ok: true });

    const gone = await fetch(`${base}/customers/${a.id}`, { headers: H });
    assertEquals(gone.status, 404);
    await gone.body?.cancel();

    const list: { id: string }[] =
      await (await fetch(`${base}/customers`, { headers: H })).json();
    assertEquals(list.some((c) => c.id === a.id), false);
    assertEquals(list.some((c) => c.id === b.id), true);
  });
});
