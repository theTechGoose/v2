/**
 * REQ-927 — "in services we need a way to migrate services to another and segment it out so we
 * can undo redo or move that segment to another spot, this way we are able to delete services
 * without fucking up the integrity of the system" — over HTTP, against the real field module.
 */
// deno-lint-ignore-file no-explicit-any
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fieldToday } from "@field/domain/business/schedule/mod.ts";
import { FieldTaskStore } from "@field/domain/data/field-stores/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9927;
const J = { "content-type": "application/json" };
type R = Record<string, any>;
type Res = { status: number; body: any };
type Call = (method: string, path: string, body?: unknown, headers?: HeadersInit) => Promise<Res>;

async function withServer(fn: (call: Call) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const call: Call = async (method, path, body, headers = {}) => {
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
    return { status: r.status, body: parsed };
  };
  try {
    await fn(call);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(call: Call, phone: string, name: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", { phoneNumber: phone, code: stored!.code });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name, language: "en" }, H);
  return H;
}

Deno.test("REQ-927 service migration — Mowing moves into Lawn cut (repeat visit, checklist, today's and past tasks, the crew), is deleted, then the segment is undone (Mowing comes back under its id), redone and moved on to Edging", async () => {
  await withServer(async (call) => {
    const H = await login(call, "+15125559270", "Migration Owner");
    const type = async (name: string) => (await call("POST", "/field/task-types", { name }, H)).body;
    const [mow, lawn, edge] = [await type("Mowing"), await type("Lawn cut"), await type("Edging")];
    const worker = (await call("POST", "/field/workers", { name: "Luis", phoneNumber: "8435559270", pin: "1234" }, H)).body;
    const crew = await call("POST", "/field/crews", { name: "Grass crew", memberIds: [worker.id], foremanId: worker.id, taskTypeIds: [mow.id] }, H);
    assertEquals(crew.status, 201, JSON.stringify(crew.body));
    await (call("POST", "/field/checklists", { name: "Full yard", items: [{ taskTypeId: mow.id, priceCents: 6500 }] }, H));
    const customer = (await call("POST", "/customers", { name: "Ana Torres", phoneNumber: "(843) 555-9270", email: "ana@blackhole.postmarkapp.com" }, H)).body;
    const today = fieldToday();
    const sub = (await call("POST", "/field/subscriptions", { customerId: customer.id, address: "4601 Dick Pond Rd, Myrtle Beach, SC", startDate: today, items: [{ taskTypeId: mow.id, priceCents: 7000 }] }, H)).body;
    await call("PUT", `/field/regions/${sub.region.id}/worker`, { crewIds: [crew.body.id] }, H);
    const day = async () => (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body.map((t: R) => t.taskTypeName);
    assertEquals(await day(), ["Mowing"]);
    // a past, completed visit on Mowing — history moves too
    const tasks = new FieldTaskStore();
    const userId = (await call("GET", "/me", undefined, H)).body.id;
    const todays = await tasks.listByRange(userId, today, today);
    const past = { ...todays[0], id: "past-1", date: "2026-01-05", status: "complete" as const };
    await tasks.put(past);

    // still in use: delete refused with the counts, crews included
    const refused = await call("DELETE", `/field/task-types/${mow.id}`, undefined, H);
    assertEquals([refused.status, refused.body?.code, refused.body?.detail], [409, "task_type_in_use", { subscriptions: 1, checklists: 1, tasks: 2, crews: 1 }]);
    // refusals: the same service, an unknown one, another account's
    assertEquals((await call("POST", `/field/task-types/${mow.id}/migrate`, { toId: mow.id }, H)).body?.code, "same_service");
    assertEquals((await call("POST", `/field/task-types/${mow.id}/migrate`, { toId: "nope" }, H)).status, 404);

    // migrate Mowing → Lawn cut
    const m = await call("POST", `/field/task-types/${mow.id}/migrate`, { toId: lawn.id }, H);
    assertEquals(m.status, 201, JSON.stringify(m.body));
    assertEquals([m.body.fromName, m.body.toName, m.body.state, m.body.counts], ["Mowing", "Lawn cut", "applied", { subscriptions: 1, checklists: 1, tasks: 2, crews: 1 }]);
    assertEquals(await day(), ["Lawn cut"]);
    const subs = (await call("GET", "/field/subscriptions", undefined, H)).body;
    assertEquals(subs[0].items.map((i: R) => [i.taskTypeName, i.priceCents, i.migratedFrom]), [["Lawn cut", 7000, [{ typeId: mow.id, migrationId: m.body.id }]]]);
    assertEquals((await call("GET", "/field/checklists", undefined, H)).body[0].items.map((i: R) => i.taskTypeName), ["Lawn cut"]);
    assertEquals((await call("GET", "/field/crews", undefined, H)).body[0].taskTypeNames, ["Lawn cut"]);
    const pastNow = await tasks.find("past-1");
    assertEquals([pastNow!.taskTypeId, pastNow!.migratedFrom], [lawn.id, [{ typeId: mow.id, migrationId: m.body.id }]]);
    // editing the repeat visit keeps the row's mark
    await call("PUT", `/field/subscriptions/${sub.id}`, { items: [{ taskTypeId: lawn.id, priceCents: 7500 }] }, H);
    assertEquals((await call("GET", "/field/subscriptions", undefined, H)).body[0].items[0].migratedFrom, [{ typeId: mow.id, migrationId: m.body.id }]);

    // Mowing is empty now: delete works
    assertEquals((await call("DELETE", `/field/task-types/${mow.id}`, undefined, H)).body, { ok: true });
    const names = async () => (await call("GET", "/field/task-types?all=1", undefined, H)).body.map((t: R) => t.name);
    assertEquals(await names(), ["Edging", "Lawn cut"]);
    const list = (await call("GET", "/field/service-migrations", undefined, H)).body;
    assertEquals(list.map((s: R) => [s.id, s.fromName, s.fromDeleted, s.toName, s.state]), [[m.body.id, "Mowing", true, "Lawn cut", "applied"]]);

    // undo: Mowing comes back under its own id, everything is on it again
    const u = await call("POST", `/field/service-migrations/${m.body.id}/undo`, undefined, H);
    assertEquals([u.status, u.body.state, u.body.fromDeleted], [200, "undone", false], JSON.stringify(u.body));
    assertEquals(await names(), ["Edging", "Lawn cut", "Mowing"]);
    assertEquals((await call("GET", "/field/task-types?all=1", undefined, H)).body.find((t: R) => t.name === "Mowing").id, mow.id);
    assertEquals(await day(), ["Mowing"]);
    assertEquals((await call("GET", "/field/subscriptions", undefined, H)).body[0].items.map((i: R) => [i.taskTypeName, i.priceCents, i.migratedFrom]), [["Mowing", 7500, undefined]]);
    assertEquals((await call("GET", "/field/crews", undefined, H)).body[0].taskTypeNames, ["Mowing"]);
    assertEquals((await tasks.find("past-1"))!.taskTypeId, mow.id);
    assertEquals((await call("POST", `/field/service-migrations/${m.body.id}/undo`, undefined, H)).body?.code, "segment_not_applied");

    // redo, then move the segment on to Edging
    const r = await call("POST", `/field/service-migrations/${m.body.id}/redo`, undefined, H);
    assertEquals([r.status, r.body.state, r.body.toName], [200, "applied", "Lawn cut"]);
    assertEquals(await day(), ["Lawn cut"]);
    const mv = await call("POST", `/field/service-migrations/${m.body.id}/move`, { toId: edge.id }, H);
    assertEquals([mv.status, mv.body.state, mv.body.toName, mv.body.history.map((h: R) => h.action)], [200, "applied", "Edging", ["migrate", "undo", "redo", "move"]]);
    assertEquals(await day(), ["Edging"]);
    assertEquals((await tasks.find("past-1"))!.taskTypeId, edge.id);
    assertEquals((await call("GET", "/field/crews", undefined, H)).body[0].taskTypeNames, ["Edging"]);
    // re-reading the day never doubles a visit
    assertEquals(await day(), ["Edging"]);

    // migrate + delete in one go
    const spare = await type("Spare");
    await call("POST", "/field/checklists", { name: "Spare list", items: [{ taskTypeId: spare.id, priceCents: 100 }] }, H);
    const both = await call("POST", `/field/task-types/${spare.id}/migrate`, { toId: lawn.id, deleteAfter: true }, H);
    assertEquals([both.status, both.body.fromDeleted], [201, true], JSON.stringify(both.body));
    assert(!(await names()).includes("Spare"));

    // another account sees none of it
    const H2 = await login(call, "+15125559271", "Other");
    assertEquals((await call("GET", "/field/service-migrations", undefined, H2)).body, []);
    assertEquals((await call("POST", `/field/service-migrations/${m.body.id}/undo`, undefined, H2)).status, 403);
    assertEquals((await call("POST", `/field/task-types/${lawn.id}/migrate`, { toId: edge.id }, H2)).status, 403);
  });
});
