/**
 * REQ-137..142 — the field module over HTTP, in process on an in-memory KV:
 * the owner's session for the office routes, the worker's pm_worker cookie
 * for theirs, and the EXISTING /customers and /invoices routes to prove the
 * module reads customers and writes invoices as they are.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";
import { FieldNotices } from "@field/domain/coordinators/field-notices/mod.ts";
import { FieldDay } from "@field/domain/coordinators/field-day/mod.ts";
import {
  FieldTaskStore,
  FieldWorkerStore,
  RegionStore,
  SubscriptionStore,
  TaskTypeStore,
} from "@field/domain/data/field-stores/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9147;
const J = { "content-type": "application/json" };

type Res = { status: number; body: any; headers: Headers };
async function withServer(
  fn: (
    call: (
      method: string,
      path: string,
      body?: unknown,
      headers?: HeadersInit,
    ) => Promise<Res>,
  ) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: HeadersInit = {},
  ) => {
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
    await fn(call);
  } finally {
    await server.stop();
    await resetKv();
  }
}
type Call = Parameters<Parameters<typeof withServer>[0]>[0];

async function login(call: Call, phone = "+15125551400", name = "Field Owner") {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name, language: "en" }, H); // the dispatch needs a real name
  return H;
}

/** owner + customer + worker + a subscription due today in a staffed zone */
async function setUp(call: Call) {
  const H = await login(call);
  const customer = (await call("POST", "/customers", {
    name: "Ana Torres",
    phoneNumber: "(843) 555-0101",
    email: "ana@blackhole.postmarkapp.com",
  }, H)).body;
  const worker = (await call("POST", "/field/workers", {
    name: "Luis",
    phoneNumber: "843-555-0201",
    pin: "1234",
  }, H)).body;
  const today = fieldToday();
  const sub = (await call("POST", "/field/subscriptions", {
    customerId: customer.id,
    address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    startDate: today,
    items: [{ taskTypeName: "Cortar césped", priceCents: 6500 }, {
      taskTypeName: "Recorte de setos",
      priceCents: 4000,
    }],
  }, H)).body;
  await call("PUT", `/field/regions/${sub.region.id}/worker`, {
    workerId: worker.id,
  }, H);
  const wl = await call("POST", "/field/worker/login", {
    phoneNumber: "8435550201",
    pin: "1234",
  });
  const W = { cookie: wl.headers.get("set-cookie")!.split(";")[0] };
  return { H, W, customer, worker, sub, today };
}

Deno.test("REQ-138 workers — created without the PIN in the answer; a wrong PIN 401s, the right one sets pm_worker; five misses lock for a minute; a duplicate cell 409s; a worker covering a zone cannot be removed", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const made = await call("POST", "/field/workers", {
      name: "Pedro",
      phoneNumber: "(843) 555-0999",
      pin: "4321",
      role: "foreman",
    }, H);
    assertEquals(made.status, 201);
    assertEquals("pin" in made.body, false, "the PIN never comes back");
    assertEquals(made.body.role, "foreman");
    assertEquals(
      (await call("POST", "/field/workers", {
        name: "Dup",
        phoneNumber: "843-555-0999",
        pin: "0000",
      }, H)).status,
      409,
    );
    assertEquals(
      (await call("POST", "/field/workers", {
        name: "NoPin",
        phoneNumber: "8435550998",
        pin: "12",
      }, H)).status,
      400,
    );
    const bad = await call("POST", "/field/worker/login", {
      phoneNumber: "8435550999",
      pin: "0000",
    });
    assertEquals(bad.status, 401);
    const ok = await call("POST", "/field/worker/login", {
      phoneNumber: "843 555 0999",
      pin: "4321",
    });
    assertEquals(ok.status, 200);
    assert(
      ok.headers.get("set-cookie")?.startsWith("pm_worker="),
      "the session cookie",
    );
    assertEquals(ok.body, {
      id: made.body.id,
      name: "Pedro",
      role: "foreman",
      language: "es", // REQ-285 — the screen's language (REQ-155: Spanish by default)
    });
    const W = { cookie: ok.headers.get("set-cookie")!.split(";")[0] };
    assertEquals(
      (await call("GET", "/field/worker/me", undefined, W)).body.name,
      "Pedro",
    );
    assertEquals((await call("GET", "/field/worker/me")).body, null);
    // the lockout
    for (let i = 0; i < 5; i++) {
      await call("POST", "/field/worker/login", {
        phoneNumber: "8435550999",
        pin: "0000",
      });
    }
    assertEquals(
      (await call("POST", "/field/worker/login", {
        phoneNumber: "8435550999",
        pin: "4321",
      })).status,
      429,
      "the right PIN is refused while locked",
    );
    // logout clears the cookie
    const out = await call("POST", "/field/worker/logout", {}, W);
    assert(out.headers.get("set-cookie")?.includes("Max-Age=0"));
    assertEquals(
      (await call("GET", "/field/worker/me", undefined, W)).body,
      null,
    );
    // the list, and the zone guard
    assertEquals(
      (await call("GET", "/field/workers", undefined, H)).body.map((
        w: { name: string },
      ) => w.name),
      ["Pedro"],
    );
    const customer =
      (await call("POST", "/customers", { name: "Zone Owner" }, H)).body;
    const sub = (await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "900 Broadway St, Myrtle Beach, SC",
      items: [{ taskTypeName: "Cut", priceCents: 100 }],
    }, H)).body;
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: made.body.id,
    }, H);
    assertEquals(
      (await call("DELETE", `/field/workers/${made.body.id}`, undefined, H))
        .status,
      409,
    );
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: null,
    }, H);
    assertEquals(
      (await call("DELETE", `/field/workers/${made.body.id}`, undefined, H))
        .status,
      200,
    );
  });
});

Deno.test("REQ-139 subscriptions — a create geocodes once and lands in a zone; an unknown type is created, a known one reused in any case; another account's customer is 403; a missing address 400", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const customer =
      (await call("POST", "/customers", { name: "Ana" }, H)).body;
    const res = await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "4725 Jordan Ridge Ct, Myrtle Beach, SC",
      cadence: "weekly",
      items: [{ taskTypeName: "cortar CÉSPED", priceCents: 7000 }, {
        taskTypeName: "Fertilizar",
        priceCents: 5000,
      }],
    }, H);
    assertEquals(res.status, 201);
    assert(
      typeof res.body.lat === "number" && typeof res.body.lng === "number",
      "geocoded",
    );
    assert(res.body.region, "joined or started a zone");
    assertEquals(res.body.customerName, "Ana");
    assertEquals(
      res.body.items.map((i: { taskTypeName: string }) => i.taskTypeName),
      ["cortar CÉSPED", "Fertilizar"],
    );
    const again = await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "1600 Kings Hwy, Myrtle Beach, SC",
      items: [{ taskTypeName: "Cortar césped", priceCents: 6000 }],
    }, H);
    assertEquals(
      again.body.items[0].taskTypeId,
      res.body.items[0].taskTypeId,
      "the same type, found in any case",
    );
    const types =
      (await call("GET", "/field/task-types?q=SETOS", undefined, H)).body;
    assertEquals(types.length, 0);
    assertEquals(
      (await call("GET", "/field/task-types?q=cesped", undefined, H)).body.map((
        t: { name: string },
      ) => t.name),
      ["cortar CÉSPED"],
    );
    assertEquals(
      (await call("POST", "/field/subscriptions", {
        customerId: customer.id,
        items: [{ taskTypeName: "x", priceCents: 1 }],
      }, H)).status,
      400,
    );
    // the schedule text
    const sched = await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "115 Surfside Dr, Myrtle Beach, SC",
      startDate: "2026-10-05",
      days: [1, 4],
      intervalWeeks: 1,
      items: [{ taskTypeName: "Cortar césped", priceCents: 6000 }],
    }, H);
    assertEquals(sched.body.schedule, {
      es: "Cada semana · lun, jue",
      en: "Every week · Mon, Thu",
    });
    // another account's customer
    const H2 = await login(call, "+15125551401", "Other Owner");
    assertEquals(
      (await call("POST", "/field/subscriptions", {
        customerId: customer.id,
        address: "1 Main St",
        items: [{ taskTypeName: "x", priceCents: 100 }],
      }, H2)).status,
      403,
    );
    assertEquals(
      (await call("GET", "/field/subscriptions", undefined, H2)).body,
      [],
    );
    // edit: pause, items; delete
    const paused = await call("PUT", `/field/subscriptions/${res.body.id}`, {
      active: false,
    }, H);
    assertEquals(paused.body.active, false);
    assertEquals(
      (await call(
        "DELETE",
        `/field/subscriptions/${again.body.id}`,
        undefined,
        H,
      )).body,
      { ok: true },
    );
    assertEquals(
      (await call("GET", "/field/subscriptions", undefined, H)).body.length,
      2,
    );
  });
});

Deno.test("REQ-140 zones — staffing a zone; a move sticks across a regroup; unpin releases it; open tasks follow the zone's new worker", async () => {
  await withServer(async (call) => {
    const { H, worker, sub, today } = await setUp(call);
    const far = (await call("POST", "/field/subscriptions", {
      customerId: sub.customerId,
      address: "1200 N Ocean Blvd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Cortar césped", priceCents: 5000 }],
    }, H)).body;
    assert(far.region.id !== sub.region.id, "12 km apart: two zones");
    let regions = (await call("GET", "/field/regions", undefined, H)).body;
    assertEquals(regions.length, 2);
    const west = regions.find((r: { id: string }) => r.id === sub.region.id);
    assertEquals(west.worker.name, "Luis");
    // move the far one into the west zone — it stays through a regroup
    const moved = await call("POST", `/field/subscriptions/${far.id}/move`, {
      regionId: sub.region.id,
    }, H);
    assertEquals([moved.body.region.id, moved.body.pinned], [
      sub.region.id,
      true,
    ]);
    await call("POST", "/field/regions/regroup", {}, H);
    regions = (await call("GET", "/field/regions", undefined, H)).body;
    assertEquals(regions.length, 1, "the emptied unstaffed zone is dropped");
    assertEquals(regions[0].subscriptions.length, 2);
    // unpin: it groups by distance again
    const unpinned = await call(
      "POST",
      `/field/subscriptions/${far.id}/unpin`,
      undefined,
      H,
    );
    assert(unpinned.body.region.id !== sub.region.id);
    // open tasks follow the zone's new worker
    const tasks =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    assert(
      tasks.length >= 2 &&
        tasks.every((t: { workerId: string }) => t.workerId === worker.id),
    );
    const marcos = (await call("POST", "/field/workers", {
      name: "Marcos",
      phoneNumber: "8435550202",
      pin: "1234",
    }, H)).body;
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: marcos.id,
    }, H);
    const after =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body
        .filter((t: { regionId: string }) => t.regionId === sub.region.id);
    assert(
      after.length >= 2 &&
        after.every((t: { workerName: string }) => t.workerName === "Marcos"),
    );
  });
});

Deno.test("REQ-141 the day — today's round exists on first read; generate reports unstaffed; the worker sees no price, completes with a note, un-checks, skips, restores, adds a service the office then prices, defers to tomorrow; the foreman closes another crew's task; a plain worker is 404 on another's", async () => {
  await withServer(async (call) => {
    const { H, W, customer, sub, today } = await setUp(call);
    const office =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    assertEquals(office.length, 2, "today's round on first read");
    assertEquals(
      office.map((t: { taskTypeName: string }) => t.taskTypeName).sort(),
      ["Cortar césped", "Recorte de setos"],
    );
    assertEquals([
      office[0].customerName,
      office[0].workerName,
      office[0].address,
    ], ["Ana Torres", "Luis", "4601 Dick Pond Rd, Myrtle Beach, SC"]);
    assertEquals(
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body
        .length,
      2,
      "idempotent",
    );
    // an unstaffed due subscription is reported by generate
    const far = (await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "1200 N Ocean Blvd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Cortar césped", priceCents: 5000 }],
    }, H)).body;
    const gen = await call("POST", "/field/tasks/generate", { date: today }, H);
    assertEquals(gen.body.created, 0);
    assertEquals(
      gen.body.skipped.map((s: { subscriptionId: string }) => s.subscriptionId),
      [far.id],
    );
    // the worker's view
    const mine =
      (await call("GET", `/field/worker/tasks?date=${today}`, undefined, W))
        .body;
    assertEquals(mine.length, 2);
    assertEquals([
      "priceCents" in mine[0],
      "invoiceId" in mine[0],
      "adminNote" in mine[0],
      mine[0].locked,
    ], [false, false, false, false]);
    const cut = mine.find((t: { taskTypeName: string }) =>
      t.taskTypeName === "Cortar césped"
    );
    const hedge = mine.find((t: { taskTypeName: string }) =>
      t.taskTypeName === "Recorte de setos"
    );
    const done = await call("POST", `/field/worker/tasks/${cut.id}/complete`, {
      note: "Portón cerrado",
    }, W);
    assertEquals([done.body.status, done.body.note], [
      "complete",
      "Portón cerrado",
    ]);
    assertEquals(
      (await call(
        "POST",
        `/field/worker/tasks/${cut.id}/uncomplete`,
        undefined,
        W,
      )).body.status,
      "assigned",
    );
    assertEquals(
      (await call("POST", `/field/worker/tasks/${cut.id}/complete`, {}, W)).body
        .status,
      "complete",
    );
    assertEquals(
      (await call("POST", `/field/worker/tasks/${hedge.id}/skip`, undefined, W))
        .body.status,
      "skipped",
    );
    assertEquals(
      (await call(
        "POST",
        `/field/worker/tasks/${hedge.id}/restore`,
        undefined,
        W,
      )).body.status,
      "assigned",
    );
    // add a service by name: $0, flagged; the office prices it
    const added = await call(
      "POST",
      `/field/worker/visits/${sub.id}/services`,
      { taskTypeName: "Soplado de hojas", date: today },
      W,
    );
    assertEquals([added.status, added.body.addedBy, added.body.addedByName], [
      201,
      "worker",
      "Luis",
    ]);
    assertEquals(
      (await call("POST", `/field/worker/visits/${sub.id}/services`, {
        taskTypeId: added.body.taskTypeId,
        date: today,
      }, W)).status,
      409,
      "a duplicate",
    );
    const priced = await call("PUT", `/field/tasks/${added.body.id}`, {
      adminNote: "Extra agreed by phone",
      priceCents: 2500,
    }, H);
    assertEquals([priced.body.priceCents, priced.body.adminNote], [
      2500,
      "Extra agreed by phone",
    ]);
    const officeNow =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    assertEquals(
      officeNow.find((t: { id: string }) => t.id === cut.id).note,
      "Portón cerrado",
      "the worker's note is for the office",
    );
    // the visit's note lands on every task of the visit
    await call("POST", `/field/worker/tasks/${hedge.id}/note`, {
      note: "Perro suelto",
    }, W);
    const noted =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    assert(
      noted.filter((t: { subscriptionId: string }) =>
        t.subscriptionId === sub.id
      ).every((t: { note: string }) => t.note === "Perro suelto"),
    );
    // defer to tomorrow
    const deferred = await call(
      "POST",
      `/field/worker/tasks/${hedge.id}/defer`,
      { note: "Lluvia" },
      W,
    );
    assertEquals([deferred.body.status, deferred.body.deferredTo], [
      "deferred",
      shiftDate(today, 1),
    ]);
    const tomorrow = (await call(
      "GET",
      `/field/tasks?date=${shiftDate(today, 1)}`,
      undefined,
      H,
    )).body;
    assertEquals(
      tomorrow.filter((t: { taskTypeId: string }) =>
        t.taskTypeId === hedge.taskTypeId
      ).map((t: { deferredFrom: string }) => t.deferredFrom),
      [today],
    );
    assertEquals(
      (await call(
        "POST",
        `/field/worker/tasks/${tomorrow[0].id}/complete`,
        {},
        W,
      )).status,
      409,
      "the future is not editable",
    );
    // another worker: 404 on Luis's tasks; a foreman closes them
    await call("POST", "/field/workers", {
      name: "Marcos",
      phoneNumber: "8435550202",
      pin: "1234",
    }, H);
    const M = {
      cookie: (await call("POST", "/field/worker/login", {
        phoneNumber: "8435550202",
        pin: "1234",
      })).headers.get("set-cookie")!.split(";")[0],
    };
    assertEquals(
      (await call("GET", `/field/worker/tasks?date=${today}`, undefined, M))
        .body,
      [],
    );
    assertEquals(
      (await call(
        "POST",
        `/field/worker/tasks/${added.body.id}/complete`,
        {},
        M,
      )).status,
      404,
    );
    await call("POST", "/field/workers", {
      name: "Jorge",
      phoneNumber: "8435550203",
      pin: "1234",
      role: "foreman",
    }, H);
    const F = {
      cookie: (await call("POST", "/field/worker/login", {
        phoneNumber: "8435550203",
        pin: "1234",
      })).headers.get("set-cookie")!.split(";")[0],
    };
    const all = (await call(
      "GET",
      `/field/worker/tasks?date=${today}&all=1`,
      undefined,
      F,
    )).body;
    assert(
      all.some((t: { workerName: string }) => t.workerName === "Luis"),
      "the foreman sees Luis's crew",
    );
    assertEquals(
      (await call(
        "POST",
        `/field/worker/tasks/${added.body.id}/complete`,
        {},
        F,
      )).body.status,
      "complete",
    );
    assertEquals(
      (await call("GET", `/field/worker/tasks?date=${today}`)).status,
      401,
    );
  });
});

Deno.test("REQ-137/142 pull — a draft per customer readable at GET /invoices (the existing controller) with the line items; the tasks stamped; a second pull pulls nothing; a deleted draft frees its tasks; send stamps sent through the existing dispatch; $0 refused without allowZero; the customer is unchanged", async () => {
  await withServer(async (call) => {
    const { H, W, customer, sub, today } = await setUp(call);
    const before =
      (await call("GET", `/customers/${customer.id}`, undefined, H)).body;
    const mine =
      (await call("GET", `/field/worker/tasks?date=${today}`, undefined, W))
        .body;
    for (const t of mine) {
      await call("POST", `/field/worker/tasks/${t.id}/complete`, {
        note: "never on the invoice",
      }, W);
    }
    const bob = (await call("POST", "/customers", {
      name: "Bob Marshall",
      phoneNumber: "8435550102",
    }, H)).body;
    const bobSub = (await call("POST", "/field/subscriptions", {
      customerId: bob.id,
      address: "6219 Forestbrook Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Cortar césped", priceCents: 7500 }],
    }, H)).body;
    assertEquals(bobSub.region.id, sub.region.id, "same zone, same worker");
    const bobTask =
      (await call("GET", `/field/worker/tasks?date=${today}`, undefined, W))
        .body.find((t: { subscriptionId: string }) =>
          t.subscriptionId === bobSub.id
        );
    await call("POST", `/field/worker/tasks/${bobTask.id}/complete`, {}, W);
    // a worker-added $0 extra, completed
    const extra =
      (await call("POST", `/field/worker/visits/${bobSub.id}/services`, {
        taskTypeName: "Soplado de hojas",
        date: today,
      }, W)).body;
    await call("POST", `/field/worker/tasks/${extra.id}/complete`, {}, W);

    const pulled = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals(pulled.status, 201);
    assertEquals(pulled.body.invoices.length, 2, "one draft per customer");
    assertEquals(pulled.body.summary, {
      pullable: 4,
      skipped: 0,
      deferred: 0,
      open: 0,
      alreadyInvoiced: 0,
      zeroPriced: 1,
    });
    const ana = pulled.body.invoices.find((i: { customerId: string }) =>
      i.customerId === customer.id
    );
    assertEquals([
      ana.status,
      ana.amount,
      ana.customerName,
      ana.lineItems.length,
      ana.zeroLines,
    ], ["draft", 10500, "Ana Torres", 2, 0]);
    assertEquals(ana.lineItems[0].quantity, 1);
    assert(
      ana.lineItems[0].description.includes("Cortar césped") &&
        ana.lineItems[0].description.includes("4601 Dick Pond Rd"),
      ana.lineItems[0].description,
    );
    // REQ-173: the line is structured too — date / service / address — so the
    // invoice can show the address as a heading with the visits under it
    assertEquals(
      [ana.lineItems[0].date, ana.lineItems[0].service],
      [today, "Cortar césped"],
    );
    assert(
      String(ana.lineItems[0].address).includes("4601 Dick Pond Rd"),
      `address on the line (${ana.lineItems[0].address})`,
    );
    assertEquals(
      JSON.stringify(pulled.body).includes("never on the invoice"),
      false,
      "the worker's note stays out",
    );
    // the EXISTING invoice controller lists them as they are
    const invoices = (await call("GET", "/invoices", undefined, H)).body;
    assertEquals(invoices.length, 2);
    const anaInv = invoices.find((i: { id: string }) => i.id === ana.id);
    assertEquals([
      anaInv.customerId,
      anaInv.status,
      anaInv.amount,
      anaInv.lineItems.length,
    ], [customer.id, "draft", 10500, 2]);
    // the tasks are stamped
    const office =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    assert(
      office.filter((t: { status: string }) => t.status === "complete").every((
        t: { invoiceId?: string },
      ) => t.invoiceId),
      "every completed task carries its invoice id",
    );
    assertEquals(
      (await call("PUT", `/field/tasks/${office[0].id}`, { priceCents: 1 }, H))
        .status,
      409,
      "no price change on an invoiced task",
    );
    assertEquals(
      (await call("GET", `/field/worker/tasks?date=${today}`, undefined, W))
        .body.every((t: { locked: boolean }) => t.locked),
      true,
    );
    // a second pull pulls nothing and records no batch
    const second = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals([
      second.status,
      second.body.invoices.length,
      second.body.summary.alreadyInvoiced,
    ], [200, 0, 4]);
    assertEquals(
      (await call("GET", "/field/batches", undefined, H)).body.length,
      1,
    );
    // the office deletes Bob's draft on the EXISTING route: the tasks are pullable again
    const bobInv = pulled.body.invoices.find((i: { customerId: string }) =>
      i.customerId === bob.id
    );
    assertEquals(
      (await call("DELETE", `/invoices/${bobInv.id}`, undefined, H)).body,
      { ok: true },
    );
    assertEquals(
      (await call("GET", `/field/batches/${pulled.body.id}`, undefined, H)).body
        .invoices.length,
      1,
      "the gone invoice is left out",
    );
    const third = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals([
      third.status,
      third.body.invoices.length,
      third.body.invoices[0].customerId,
      third.body.invoices[0].zeroLines,
    ], [201, 1, bob.id, 1]);
    // send: the $0 draft is refused without allowZero; Ana's goes by email (the dev fake) and is stamped sent
    const refused = await call("POST", `/field/batches/${third.body.id}/send`, {
      invoiceIds: [third.body.invoices[0].id],
    }, H);
    assertEquals(refused.status, 409);
    const sent = await call("POST", `/field/batches/${pulled.body.id}/send`, {
      invoiceIds: [ana.id],
    }, H);
    assertEquals([sent.status, sent.body.sent, sent.body.failed], [200, 1, []]);
    const anaAfter =
      (await call("GET", `/invoices/${ana.id}`, undefined, H)).body;
    assertEquals([anaAfter.status, anaAfter.issuedDate], ["sent", today]);
    const forced = await call("POST", `/field/batches/${third.body.id}/send`, {
      invoiceIds: [third.body.invoices[0].id],
      allowZero: true,
    }, H);
    assertEquals(
      forced.body.sent + forced.body.failed.length,
      1,
      "a text to a customer with only a phone is attempted, and reported either way",
    );
    // REQ-137: the customer record is exactly what it was
    assertEquals(
      (await call("GET", `/customers/${customer.id}`, undefined, H)).body,
      before,
    );
  });
});

Deno.test("REQ-157 a monthly subscription with daysOfMonth answers them sorted and unique with the schedule text; 0 or 32 is 400; a PATCH replaces them", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const customer =
      (await call("POST", "/customers", { name: "Ana" }, H)).body;
    const body = (daysOfMonth: unknown) => ({
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      cadence: "monthly",
      startDate: "2026-11-01",
      daysOfMonth,
      items: [{ taskTypeName: "Cut", priceCents: 100 }],
    });
    const res = await call(
      "POST",
      "/field/subscriptions",
      body([31, 15, 15]),
      H,
    );
    assertEquals(res.status, 201);
    assertEquals(res.body.daysOfMonth, [15, 31]);
    assertEquals(res.body.schedule, {
      es: "Mensual · días 15, 31",
      en: "Monthly · days 15, 31",
    });
    assertEquals(
      (await call("POST", "/field/subscriptions", body([0]), H)).status,
      400,
    );
    assertEquals(
      (await call("POST", "/field/subscriptions", body([32]), H)).status,
      400,
    );
    assertEquals(
      (await call("POST", "/field/subscriptions", body("15"), H)).status,
      400,
    );
    const patched = await call("PUT", `/field/subscriptions/${res.body.id}`, {
      daysOfMonth: [1],
    }, H);
    assertEquals(patched.body.daysOfMonth, [1]);
    assertEquals(patched.body.schedule.en, "Monthly · day 1");
    const plain = await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "1600 Kings Hwy, Myrtle Beach, SC",
      cadence: "monthly",
      startDate: "2026-11-05",
      items: [{ taskTypeName: "Cut", priceCents: 100 }],
    }, H);
    assertEquals(
      plain.body.schedule.en,
      "Monthly · day 5",
      "no picks keeps the first visit's day",
    );
  });
});

Deno.test("REQ-159 the office completes and re-opens a task; a bad status is 400; an invoiced task is 409", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const today = fieldToday();
    const customer =
      (await call("POST", "/customers", { name: "Ana" }, H)).body;
    const w = (await call("POST", "/field/workers", {
      name: "Pedro",
      phoneNumber: "8435550777",
      pin: "4321",
    }, H)).body;
    const sub = (await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Cut", priceCents: 6500 }],
    }, H)).body;
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: w.id,
    }, H);
    const day = (await call("GET", "/field/tasks", undefined, H)).body;
    assertEquals(day.length, 1);
    const id = day[0].id;
    const done = await call(
      "PUT",
      `/field/tasks/${id}`,
      { status: "complete" },
      H,
    );
    assertEquals(done.status, 200);
    assertEquals(done.body.status, "complete");
    assert(typeof done.body.completedAt === "string", "completedAt stamped");
    const open = await call(
      "PUT",
      `/field/tasks/${id}`,
      { status: "assigned" },
      H,
    );
    assertEquals([open.body.status, open.body.completedAt], [
      "assigned",
      undefined,
    ]);
    assertEquals(
      (await call("PUT", `/field/tasks/${id}`, { status: "skipped" }, H))
        .status,
      400,
    );
    await call("PUT", `/field/tasks/${id}`, { status: "complete" }, H);
    const pulled = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals(pulled.status, 201);
    assertEquals(
      (await call("PUT", `/field/tasks/${id}`, { status: "assigned" }, H))
        .status,
      409,
      "on an invoice now",
    );
  });
});

// REQ-174 — "subscriptions needs a field to define how long they have to pay the invoice from the
// date sent. it should default to a field on the customer settings that is a number"
Deno.test("REQ-174 a subscription's days to pay (defaulting to the account's setting) sets the draft's netDays and due date; the due date is re-dated from the day the batch is sent", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    // the account default
    const ident = await call("PUT", "/profile/identity", {
      businessName: "A2Z Landscape LLC",
      invoiceNetDays: 21,
    }, H);
    assertEquals(ident.status, 200, JSON.stringify(ident.body));
    assertEquals(ident.body.invoiceNetDays, 21);
    const mk = async (name: string) =>
      (await call("POST", "/customers", {
        name,
        email: `${
          name.replace(/\W+/g, ".").toLowerCase()
        }@blackhole.postmarkapp.com`,
      }, H)).body;
    const randall = await mk("Randall Belknap");
    const robert = await mk("Robert Thall");
    const today = fieldToday();
    // a subscription with its own days, one without, one refused
    const s14 = await call("POST", "/field/subscriptions", {
      customerId: randall.id,
      address: "725 Frederick Rd, Rockingham, VA",
      startDate: today,
      items: [{ taskTypeName: "Lawn", priceCents: 6500 }],
      netDays: 14,
    }, H);
    assertEquals(s14.status, 201, JSON.stringify(s14.body));
    assertEquals(s14.body.netDays, 14);
    const sDefault = await call("POST", "/field/subscriptions", {
      customerId: robert.id,
      address: "845 Frederick Rd, Rockingham, VA",
      startDate: today,
      items: [{ taskTypeName: "Lawn", priceCents: 6500 }],
    }, H);
    assertEquals(sDefault.status, 201);
    assertEquals(sDefault.body.netDays, undefined);
    const bad = await call("POST", "/field/subscriptions", {
      customerId: robert.id,
      address: "x",
      items: [{ taskTypeName: "Lawn", priceCents: 1 }],
      netDays: 400,
    }, H);
    assertEquals(bad.status, 400);
    // an edit clears it
    const cleared = await call("PUT", `/field/subscriptions/${s14.body.id}`, {
      netDays: null,
    }, H);
    assertEquals(cleared.body.netDays, undefined);
    assertEquals(
      (await call(
        "PUT",
        `/field/subscriptions/${s14.body.id}`,
        { netDays: 14 },
        H,
      )).body.netDays,
      14,
    );
    // the day's tasks, completed by the office, then the batch
    const w = (await call("POST", "/field/workers", {
      name: "Mario",
      phoneNumber: "8435550999",
      pin: "2468",
    }, H)).body;
    const regions = (await call("GET", "/field/regions", undefined, H)).body;
    for (const r of regions) {
      await call("PUT", `/field/regions/${r.id}/worker`, { workerId: w.id }, H);
    }
    await call("POST", "/field/tasks/generate", { date: today }, H);
    const tasks =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    assertEquals(tasks.length, 2, JSON.stringify(tasks));
    for (const t of tasks) {
      assertEquals(
        (await call("PUT", `/field/tasks/${t.id}`, { status: "complete" }, H))
          .status,
        200,
      );
    }
    const pulled = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals(pulled.status, 201, JSON.stringify(pulled.body));
    const draft = (customerId: string) =>
      pulled.body.invoices.find((i: { customerId: string }) =>
        i.customerId === customerId
      );
    assertEquals([draft(randall.id).netDays, draft(randall.id).dueDate], [
      14,
      shiftDate(today, 14),
    ]);
    assertEquals([draft(robert.id).netDays, draft(robert.id).dueDate], [
      21,
      shiftDate(today, 21),
    ]);
    // sent → due = sent day + days to pay (the drafts were due from the pull day; re-dated on send)
    const sent = await call("POST", `/field/batches/${pulled.body.id}/send`, {
      invoiceIds: [draft(randall.id).id],
    }, H);
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    assertEquals(sent.body.sent, 1, JSON.stringify(sent.body));
    const after =
      (await call("GET", `/invoices/${draft(randall.id).id}`, undefined, H))
        .body;
    assertEquals([after.status, after.dueDate, after.netDays], [
      "sent",
      shiftDate(today, 14),
      14,
    ]);
  });
});

/** the fields these tests read off a task row */
type Row = {
  id: string;
  taskTypeName: string;
  oneOff?: true;
  workerId: string;
};

/** REQ-163..166 — a staffed subscription due today, as the office sees it; answers the headers, the worker, the customer and the day's first task */
/** REQ-177: the account's fieldTexts flag — the texts of REQ-171/172 need it on */
async function textsOn(call: Call, H: HeadersInit) {
  const me = await call("GET", "/me", undefined, H);
  await new UserStore().setFeature(me.body.id, "fieldTexts", true);
}

async function todaysRound(call: Call, phone = "+15125551630", texts = true) {
  const H = await login(call, phone);
  if (texts) await textsOn(call, H);
  const today = fieldToday();
  const customer = (await call("POST", "/customers", {
    name: "Ana Torres",
    address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    phoneNumber: "+18435550299", // REQ-523: a textable number (555-01XX is never texted)
  }, H)).body;
  const w = (await call("POST", "/field/workers", {
    name: "Pedro",
    phoneNumber: "8435550" + phone.slice(-3),
    pin: "4321",
  }, H)).body;
  const sub = (await call("POST", "/field/subscriptions", {
    customerId: customer.id,
    address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    startDate: today,
    items: [{ taskTypeName: "Cut", priceCents: 6500 }, {
      taskTypeName: "Edge",
      priceCents: 2500,
    }],
  }, H)).body;
  await call("PUT", `/field/regions/${sub.region.id}/worker`, {
    workerId: w.id,
  }, H);
  const day = (await call("GET", "/field/tasks", undefined, H)).body;
  assertEquals(day.length, 2);
  return {
    H,
    today,
    customer,
    w,
    sub,
    task: day.find((t: Row) => t.taskTypeName === "Cut"),
    day,
  };
}

// REQ-163 — "when in tasks i need a button to delete a task"
Deno.test("REQ-163 the office deletes a task; an invoiced task is 409; another account's is 403", async () => {
  await withServer(async (call) => {
    const { H, today, task, day } = await todaysRound(call);
    const gone = await call("DELETE", `/field/tasks/${task.id}`, undefined, H);
    assertEquals([gone.status, gone.body.ok], [200, true]); // REQ-171 adds `texted` to the answer
    const after =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    assertEquals(after.map((t: Row) => t.id), [
      day.find((t: Row) => t.id !== task.id).id,
    ]);
    // the other one, done and invoiced, cannot go
    const edge = after[0];
    await call("PUT", `/field/tasks/${edge.id}`, { status: "complete" }, H);
    const pull = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals(pull.status, 201);
    const locked = await call(
      "DELETE",
      `/field/tasks/${edge.id}`,
      undefined,
      H,
    );
    assertEquals(locked.status, 409);
    const other = await login(call, "+15125551631", "Other Owner");
    assertEquals(
      (await call("DELETE", `/field/tasks/${edge.id}`, undefined, other))
        .status,
      403,
    );
  });
});

// REQ-340 (demo-loop cycle 1, M37) — the task's address carries over to a customer who had none
Deno.test("REQ-340 a one-off task's address becomes the customer's when they had none; a customer with one keeps it", async () => {
  await withServer(async (call) => {
    const { H, today, w } = await todaysRound(call, "+15125551633");
    // the demo's order: the customer was added from the form before the address was typed
    const dave =
      (await call("POST", "/customers", { name: "Dave Kowalski" }, H))
        .body;
    assertEquals(dave.address ?? undefined, undefined);
    const made = await call("POST", "/field/tasks", {
      customerId: dave.id,
      date: today,
      taskTypeName: "Gutter clean",
      priceCents: 15000,
      workerId: w.id,
      address: "8807 Spicewood Springs Rd, Austin, TX",
    }, H);
    assertEquals(made.status, 201);
    assertEquals(made.body.address, "8807 Spicewood Springs Rd, Austin, TX");
    const after =
      (await call("GET", `/customers/${dave.id}`, undefined, H)).body;
    assertEquals(
      after.address,
      "8807 Spicewood Springs Rd, Austin, TX",
      "the customer now has the task's address on file",
    );
    // a customer with an address keeps it: the task's is that job's service address only
    const other = await call("POST", "/field/tasks", {
      customerId: dave.id,
      date: today,
      taskTypeName: "Gutter clean",
      priceCents: 15000,
      workerId: w.id,
      address: "1 Rental Unit Ln, Austin, TX",
    }, H);
    assertEquals(other.status, 201);
    assertEquals(other.body.address, "1 Rental Unit Ln, Austin, TX");
    const kept =
      (await call("GET", `/customers/${dave.id}`, undefined, H)).body;
    assertEquals(kept.address, "8807 Spicewood Springs Rd, Austin, TX");
  });
});

// REQ-164 — "when in tasks i need a button to manually add a task as a one off"
Deno.test("REQ-164 the office posts a one-off task; it lists on the day, survives generation, needs a worker, and pulls into a batch", async () => {
  await withServer(async (call) => {
    const { H, today, customer, w } = await todaysRound(call, "+15125551632");
    const tomorrow = shiftDate(today, 1);
    const made = await call("POST", "/field/tasks", {
      customerId: customer.id,
      date: tomorrow,
      taskTypeName: "Mulch",
      priceCents: 12000,
      workerId: w.id,
    }, H);
    assertEquals(made.status, 201);
    assertEquals([
      made.body.oneOff,
      made.body.subscriptionId,
      made.body.taskTypeName,
      made.body.priceCents,
      made.body.workerId,
      made.body.address,
      made.body.addedBy,
      made.body.status,
    ], [
      true,
      "",
      "Mulch",
      12000,
      w.id,
      "4601 Dick Pond Rd, Myrtle Beach, SC",
      "office",
      "assigned",
    ]);
    // the worker falls back to the customer's subscription's zone when omitted
    const derived = await call("POST", "/field/tasks", {
      customerId: customer.id,
      date: tomorrow,
      taskTypeName: "Mulch",
      priceCents: 500,
    }, H);
    assertEquals([derived.status, derived.body.workerId], [201, w.id]);
    // no customer, no worker to derive from → 400; a foreign customer → 404
    const loner =
      (await call("POST", "/customers", { name: "Nobody Nearby" }, H)).body;
    assertEquals(
      (await call("POST", "/field/tasks", {
        customerId: loner.id,
        date: tomorrow,
        taskTypeName: "Mulch",
        priceCents: 500,
      }, H)).status,
      400,
    );
    assertEquals(
      (await call("POST", "/field/tasks", {
        customerId: "nope",
        date: tomorrow,
        taskTypeName: "Mulch",
        priceCents: 500,
        workerId: w.id,
      }, H)).status,
      404,
    );
    // tomorrow's day lists the round AND both one-offs; generating again changes nothing
    const list = async () =>
      (await call("GET", `/field/tasks?date=${tomorrow}`, undefined, H))
        .body as Row[];
    const before = await list();
    await call("POST", "/field/tasks/generate", { date: tomorrow }, H);
    const after = await list();
    assertEquals(after.filter((t: Row) => t.oneOff).length, 2);
    assertEquals(after.length, before.length);
    // done → on an invoice with its address
    await call(
      "PUT",
      `/field/tasks/${made.body.id}`,
      { status: "complete" },
      H,
    );
    const pull = await call("POST", "/field/batches/pull", {
      from: tomorrow,
      to: tomorrow,
    }, H);
    assertEquals(pull.status, 201);
    assertEquals(pull.body.invoices.length, 1);
    assertEquals(pull.body.invoices[0].amount, 12000);
    assert(
      pull.body.invoices[0].lineItems[0].description.includes(
        "Mulch — 4601 Dick Pond Rd",
      ),
      pull.body.invoices[0].lineItems[0].description,
    );
  });
});

// REQ-165 — "when in tasks i need to be able to add services to a task as a one off."
Deno.test("REQ-165 the office adds a service to a visit; a duplicate is 409", async () => {
  await withServer(async (call) => {
    const { H, today, task, w, sub } = await todaysRound(call, "+15125551633");
    const added = await call("POST", `/field/tasks/${task.id}/services`, {
      taskTypeName: "Aeration",
      priceCents: 4000,
    }, H);
    assertEquals(added.status, 201);
    assertEquals([
      added.body.taskTypeName,
      added.body.priceCents,
      added.body.workerId,
      added.body.subscriptionId,
      added.body.date,
      added.body.addedBy,
      added.body.customerId,
    ], ["Aeration", 4000, w.id, sub.id, today, "office", task.customerId]);
    // the subscription's price when none is given, for a type it lists — but Edge is already on the visit → 409
    assertEquals(
      (await call("POST", `/field/tasks/${task.id}/services`, {
        taskTypeName: "Edge",
      }, H)).status,
      409,
    );
    assertEquals(
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body
        .length,
      3,
    );
  });
});

// REQ-166 — "when in tasks i need to be able to change the worker of a task as a one off"
Deno.test("REQ-166 the office reassigns a task; a foreign worker is 400; an invoiced task is 409", async () => {
  await withServer(async (call) => {
    const { H, today, task, w } = await todaysRound(call, "+15125551634");
    const w2 = (await call("POST", "/field/workers", {
      name: "Luis",
      phoneNumber: "8435550635",
      pin: "4321",
    }, H)).body;
    const moved = await call("PUT", `/field/tasks/${task.id}`, {
      workerId: w2.id,
    }, H);
    assertEquals([moved.status, moved.body.workerId, moved.body.workerName], [
      200,
      w2.id,
      "Luis",
    ]);
    // the zone still belongs to the first worker: tomorrow's round goes to them
    const tomorrow = shiftDate(today, 7);
    const next =
      (await call("GET", `/field/tasks?date=${tomorrow}`, undefined, H)).body;
    assert(
      next.length === 0 || next.every((t: Row) => t.workerId === w.id),
      "the subscription's zone is untouched",
    );
    assertEquals(
      (await call("PUT", `/field/tasks/${task.id}`, { workerId: "nope" }, H))
        .status,
      400,
    );
    await call("PUT", `/field/tasks/${task.id}`, { status: "complete" }, H);
    await call("POST", "/field/batches/pull", { from: today, to: today }, H);
    assertEquals(
      (await call("PUT", `/field/tasks/${task.id}`, { workerId: w.id }, H))
        .status,
      409,
    );
  });
});

// REQ-170 — "i dont need a generate button in tasks, just keep it up to date in realtime when subscriptions change."
Deno.test("REQ-170 a future day materializes on read for the office and the worker; a schedule change re-derives open work, sparing a one-off and a done task; the unstaffed list reads back", async () => {
  await withServer(async (call) => {
    const { H, today, customer, w, sub } = await todaysRound(
      call,
      "+15125551700",
    );
    const nextWeek = shiftDate(today, 7);
    // a week ahead, read cold: the round is there — nobody generated it
    const ahead =
      (await call("GET", `/field/tasks?date=${nextWeek}`, undefined, H))
        .body as Row[];
    assertEquals(ahead.map((t) => t.taskTypeName).sort(), ["Cut", "Edge"]);
    // the worker sees it too, cold
    const login = await call("POST", "/field/worker/login", {
      phoneNumber: w.phoneNumber,
      pin: "4321",
    });
    const WC = {
      cookie: (login.headers.get("set-cookie") ?? "").split(";")[0],
    };
    const inTwo = shiftDate(today, 14);
    const theirs =
      (await call("GET", `/field/worker/tasks?date=${inTwo}`, undefined, WC))
        .body as Row[];
    assertEquals(theirs.length, 2);
    // a one-off and a done task on that day
    const one = (await call("POST", "/field/tasks", {
      customerId: customer.id,
      date: nextWeek,
      taskTypeName: "Mulch",
      priceCents: 500,
      workerId: w.id,
    }, H)).body;
    await call("PUT", `/field/tasks/${ahead[0].id}`, { status: "complete" }, H);
    // the subscription moves to the next weekday: open work re-derives, the one-off and the done task stay
    const weekday = (new Date(today + "T12:00:00Z").getUTCDay() + 1) % 7;
    const moved = await call("PUT", `/field/subscriptions/${sub.id}`, {
      days: [weekday],
    }, H);
    assertEquals(moved.status, 200);
    const after =
      (await call("GET", `/field/tasks?date=${nextWeek}`, undefined, H))
        .body as Row[];
    assertEquals(after.map((t) => t.id).sort(), [one.id, ahead[0].id].sort());
    const newDay = (await call(
      "GET",
      `/field/tasks?date=${shiftDate(nextWeek, 1)}`,
      undefined,
      H,
    )).body as Row[];
    assertEquals(newDay.map((t) => t.taskTypeName).sort(), ["Cut", "Edge"]);
    // the zone loses its worker: the subscription is listed as unstaffed for its day
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: null,
    }, H);
    const un = await call(
      "GET",
      `/field/tasks/unstaffed?date=${shiftDate(nextWeek, 1)}`,
      undefined,
      H,
    );
    assertEquals(un.status, 200);
    assertEquals(
      un.body.map((
        s: { subscriptionId: string; customerName: string },
      ) => [s.subscriptionId, s.customerName]),
      [[sub.id, "Ana Torres"]],
    );
  });
});

/** REQ-171/172 — a Twilio stand-in on a port: every text the app sends lands here; the env points the SmsService at it */
async function withTwilioStub(
  fn: (texts: { to: string; body: string }[]) => Promise<void>,
) {
  const texts: { to: string; body: string }[] = [];
  const stub = Deno.serve({ port: 9148, onListen() {} }, async (req) => {
    const form = new URLSearchParams(await req.text());
    texts.push({ to: form.get("To") ?? "", body: form.get("Body") ?? "" });
    return Response.json({ sid: `SM${texts.length}` });
  });
  const prev = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM",
    "TWILIO_BASE_URL",
  ].map((k) => [k, Deno.env.get(k)] as const);
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok");
  Deno.env.set("TWILIO_FROM", "+15550001111");
  Deno.env.set("TWILIO_BASE_URL", "http://localhost:9148");
  try {
    await fn(texts);
  } finally {
    for (const [k, v] of prev) {
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
    await stub.shutdown();
  }
}
const CUSTOMER_PHONE = "+18435550299"; // REQ-523: 555-01XX numbers are never texted

// REQ-171 — "send text messages to the workers if they get a new one off task for the day" / "… to customers if a one off service is canceled" / "… if their service is canceled or deffered."
Deno.test("REQ-171 a one-off for today texts the worker, tomorrow's does not; delete / skip / defer text the customer, once", async () => {
  await withTwilioStub(async (texts) => {
    await withServer(async (call) => {
      const { H, today, customer, w, task, day } = await todaysRound(
        call,
        "+15125551710",
      );
      const workerPhone = "+1" + w.phoneNumber;
      const toWorker = () =>
        texts.filter((x) => x.to === workerPhone && !/PIN/.test(x.body));
      const toCustomer = () => texts.filter((x) => x.to === CUSTOMER_PHONE);
      // a one-off for today → the worker hears; for tomorrow → nothing
      await call("POST", "/field/tasks", {
        customerId: customer.id,
        date: today,
        taskTypeName: "Mulch",
        priceCents: 500,
        workerId: w.id,
      }, H);
      assertEquals(toWorker().length, 1);
      assert(
        toWorker()[0].body.includes("Mulch") &&
          toWorker()[0].body.includes("Ana Torres"),
        toWorker()[0].body,
      );
      await call("POST", "/field/tasks", {
        customerId: customer.id,
        date: shiftDate(today, 1),
        taskTypeName: "Mulch",
        priceCents: 500,
        workerId: w.id,
      }, H);
      assertEquals(
        toWorker().length,
        1,
        "tomorrow's one-off is not today's news",
      );
      // a service added to today's visit → the worker hears again; moved to another worker → that worker hears
      await call("POST", `/field/tasks/${task.id}/services`, {
        taskTypeName: "Aeration",
        priceCents: 1000,
      }, H);
      assertEquals(toWorker().length, 2);
      const w2 = (await call("POST", "/field/workers", {
        name: "Luis",
        phoneNumber: "8435550712",
        pin: "4321",
      }, H)).body;
      await call("PUT", `/field/tasks/${task.id}`, { workerId: w2.id }, H);
      const toLuis = texts.filter((x) =>
        x.to === "+18435550712" && !/PIN/.test(x.body)
      );
      assertEquals(toLuis.length, 1);
      assert(toLuis[0].body.includes("Cut"), toLuis[0].body);
      // the office deletes today's Edge → the customer hears it was canceled
      const edge = day.find((t: Row) => t.taskTypeName === "Edge")!;
      assertEquals(toCustomer().length, 0);
      await call("DELETE", `/field/tasks/${edge.id}`, undefined, H);
      assertEquals(toCustomer().length, 1);
      assert(
        /cancel/i.test(toCustomer()[0].body) &&
          toCustomer()[0].body.includes("Edge"),
        toCustomer()[0].body,
      );
      // the worker marks Cut not done → canceled text; defers Aeration → "moved to" text
      const login = await call("POST", "/field/worker/login", {
        phoneNumber: w2.phoneNumber,
        pin: "4321",
      });
      const WC = {
        cookie: (login.headers.get("set-cookie") ?? "").split(";")[0],
      };
      await call("POST", `/field/worker/tasks/${task.id}/skip`, {}, WC);
      assertEquals(toCustomer().length, 2);
      assert(toCustomer()[1].body.includes("Cut"), toCustomer()[1].body);
      await call("POST", `/field/worker/tasks/${task.id}/skip`, {}, WC);
      assertEquals(toCustomer().length, 2, "skipped twice, told once");
      const mine = (await call("GET", "/field/tasks", undefined, H))
        .body as Row[];
      const aeration = mine.find((t) => t.taskTypeName === "Aeration")!;
      const login1 = await call("POST", "/field/worker/login", {
        phoneNumber: w.phoneNumber,
        pin: "4321",
      });
      const WC1 = {
        cookie: (login1.headers.get("set-cookie") ?? "").split(";")[0],
      };
      const deferred = await call(
        "POST",
        `/field/worker/tasks/${aeration.id}/defer`,
        { note: "rain" },
        WC1,
      );
      assertEquals(deferred.status, 200);
      assertEquals(toCustomer().length, 3);
      assert(toCustomer()[2].body.includes("Aeration"), toCustomer()[2].body);
    });
  });
});

// REQ-172 — "send text messages to customers at 9 am based on their local time that they are on the schedule for the day"
Deno.test("REQ-172 the sweep at 09:05 New York texts the day's customers once; Honolulu at the same instant is not due; the minute timer registers", async () => {
  await withTwilioStub(async (texts) => {
    await withServer(async (call) => {
      const { H, today } = await todaysRound(call, "+15125551720");
      const tz = await call("PUT", "/profile/identity", {
        businessName: "A2Z Landscape LLC",
        timezone: "America/New_York",
      }, H);
      assertEquals([tz.status, tz.body.timezone], [200, "America/New_York"]);
      assertEquals(
        (await call(
          "PUT",
          "/profile/identity",
          { timezone: "Mars/Olympus" },
          H,
        )).status,
        400,
      );
      const notices = new FieldNotices(
        new UserStore(),
        new BusinessIdentityStore(),
        new CustomerStore(),
        new FieldWorkerStore(),
        new TaskTypeStore(),
        new SubscriptionStore(),
        new FieldDay(
          new SubscriptionStore(),
          new RegionStore(),
          new FieldTaskStore(),
        ),
        new SmsService(),
      );
      const at = new Date(today + "T14:05:00Z"); // 09:05 or 10:05 New York, either way past nine, same date
      const toCustomer = () => texts.filter((x) => x.to === CUSTOMER_PHONE);
      const first = await notices.sweep(at);
      assertEquals([first.accounts, first.texted], [1, 1]);
      assert(
        toCustomer()[0].body.includes("A2Z Landscape LLC") &&
          toCustomer()[0].body.includes("Cut") &&
          toCustomer()[0].body.includes("Edge"),
        toCustomer()[0].body,
      );
      const second = await notices.sweep(new Date(at.getTime() + 60_000));
      assertEquals([second.texted, toCustomer().length], [0, 1], "once a day");
      // the same account in Honolulu: 04:05 local — not due; tomorrow's instant
      await call(
        "PUT",
        "/profile/identity",
        { timezone: "Pacific/Honolulu" },
        H,
      );
      const third = await notices.sweep(
        new Date(shiftDate(today, 1) + "T14:05:00Z"),
      );
      assertEquals([third.texted, toCustomer().length], [0, 1]);
      const scheduled: number[] = [];
      assert(
        notices.registerSweep((_fn, ms) => {
          scheduled.push(ms);
          return 7;
        }, () => {}),
        "the minute timer is set",
      );
      assertEquals(scheduled, [60_000]);
    });
  });
});

// REQ-255 (demo issue onboarding-dashboard-settings-m3a) — an Austin, TX business sat on New York time: the 9 am texts went out at 8 am Central
/** the UTC instant at which `tz`'s wall clock reads hh:mm on `date` */
function wallClock(date: string, hhmm: string, tz: string): Date {
  for (let h = 0; h < 24; h++) {
    const at = new Date(
      `${date}T${String(h).padStart(2, "0")}:${hhmm.slice(3)}:00Z`,
    );
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at).replace(",", "");
    if (local === `${date} ${hhmm}`) return at;
  }
  throw new Error(`${tz} never reads ${hhmm} on ${date}`);
}

Deno.test("REQ-255 with no zone picked, a TX address puts the 9 am sweep on Central time: 09:30 New York is not due, 09:30 Chicago is", async () => {
  await withTwilioStub(async (texts) => {
    await withServer(async (call) => {
      const { H, today } = await todaysRound(call, "+15125551755");
      await call("PUT", "/profile/identity", {
        businessName: "Austin Lawn Co",
      }, H);
      const addr = await call("PUT", "/profile/address", {
        street: "1600 Congress Ave",
        city: "Austin",
        state: "TX",
        postal: "78701",
        country: "US",
      }, H);
      assertEquals(addr.status, 200);
      const notices = new FieldNotices(
        new UserStore(),
        new BusinessIdentityStore(),
        new CustomerStore(),
        new FieldWorkerStore(),
        new TaskTypeStore(),
        new SubscriptionStore(),
        new FieldDay(
          new SubscriptionStore(),
          new RegionStore(),
          new FieldTaskStore(),
        ),
        new SmsService(),
      );
      const toCustomer = () => texts.filter((x) => x.to === CUSTOMER_PHONE);
      const early = await notices.sweep(
        wallClock(today, "09:30", "America/New_York"),
      );
      assertEquals(
        [early.texted, toCustomer().length],
        [0, 0],
        "08:30 in Austin — not 9 am yet",
      );
      const due = await notices.sweep(
        wallClock(today, "09:30", "America/Chicago"),
      );
      assertEquals(
        [due.texted, toCustomer().length],
        [1, 1],
        "09:30 in Austin",
      );
    });
  });
});

// REQ-170 — the office page and a worker read the same day at the same instant: one round, not two
Deno.test("REQ-170 two reads of the same day at once make one round; a generated task's id is stable", async () => {
  await withServer(async (call) => {
    const H = await login(call, "+15125551701");
    const customer =
      (await call("POST", "/customers", { name: "Ana Torres" }, H)).body;
    const w = (await call("POST", "/field/workers", {
      name: "Pedro",
      phoneNumber: "8435550701",
      pin: "4321",
    }, H)).body;
    const sub = (await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: fieldToday(),
      items: [{ taskTypeName: "Cut", priceCents: 6500 }],
    }, H)).body;
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: w.id,
    }, H);
    const d = shiftDate(fieldToday(), 7);
    const reads = await Promise.all(
      [1, 2, 3, 4].map(() =>
        call("GET", `/field/tasks?date=${d}`, undefined, H)
      ),
    );
    const after = (await call("GET", `/field/tasks?date=${d}`, undefined, H))
      .body as Row[];
    assertEquals(
      after.length,
      1,
      `four reads at once: ${
        reads.map((r) => (r.body as Row[]).length).join(",")
      } → ${after.length}`,
    );
    const ids = new Set(
      reads.flatMap((r) => (r.body as Row[]).map((t) => t.id)),
    );
    assertEquals([...ids], [after[0].id], "every read answered the same task");
  });
});

// REQ-177 — "put the texting feature behind a feature flag on the account."
Deno.test("REQ-177 with the account's fieldTexts flag off nothing is texted and the answers say texted:false; once the flag is on the worker hears", async () => {
  await withTwilioStub(async (texts) => {
    await withServer(async (call) => {
      const { H, today, customer, w } = await todaysRound(
        call,
        "+15125551770",
        false,
      );
      const workerPhone = "+1" + w.phoneNumber;
      const toWorker = () =>
        texts.filter((x) => x.to === workerPhone && !/PIN/.test(x.body));
      const off = await call("POST", "/field/tasks", {
        customerId: customer.id,
        date: today,
        taskTypeName: "Mulch",
        priceCents: 500,
        workerId: w.id,
      }, H);
      assertEquals([off.status, off.body.texted], [201, false]);
      assertEquals(toWorker().length, 0, "flag off → no text");
      await textsOn(call, H);
      const on = await call("POST", "/field/tasks", {
        customerId: customer.id,
        date: today,
        taskTypeName: "Edging",
        priceCents: 500,
        workerId: w.id,
      }, H);
      assertEquals([on.status, on.body.texted], [201, true]);
      assertEquals(toWorker().length, 1, "flag on → the worker hears");
    });
  });
});

Deno.test("REQ-288 GET /field/regions/center — demo m5: an Austin, TX business with no subscriptions starts on Austin; no address → the whole US; geocoded once per address", async () => {
  await withServer(async (call) => {
    const H = await login(call, "+15125551880");
    const none = await call("GET", "/field/regions/center", undefined, H);
    assertEquals(none.status, 200, JSON.stringify(none.body));
    assertEquals(none.body.source, "none");
    assert(none.body.zoom <= 5, JSON.stringify(none.body));
    assert(
      Math.abs(none.body.lat - 33.69) > 1 ||
        Math.abs(none.body.lng + 78.93) > 1,
      `not Myrtle Beach: ${JSON.stringify(none.body)}`,
    );

    const put = await call("PUT", "/profile/address", {
      street: "1600 Congress Ave",
      city: "Austin",
      state: "TX",
      postal: "78701",
    }, H);
    assertEquals(put.status, 200, JSON.stringify(put.body));
    const geo =
      (await import("@field/domain/data/geocoder/mod.ts")).FakeGeocoder;
    const before = geo.prototype.geocode;
    let calls = 0;
    geo.prototype.geocode = function (a: string) {
      calls++;
      return before.call(this, a);
    };
    try {
      const at = await call("GET", "/field/regions/center", undefined, H);
      assertEquals(at.status, 200, JSON.stringify(at.body));
      assertEquals(at.body.source, "business");
      assert(
        Math.abs(at.body.lat - 30.27) < 0.25 &&
          Math.abs(at.body.lng + 97.74) < 0.25,
        `Austin: ${JSON.stringify(at.body)}`,
      );
      assert(at.body.zoom >= 9, JSON.stringify(at.body));
      await call("GET", "/field/regions/center", undefined, H);
      assertEquals(calls, 1, "the same address is geocoded once");
      await call("PUT", "/profile/address", {
        city: "Denver",
        state: "CO",
        street: "",
        postal: "",
      }, H);
      const moved = await call("GET", "/field/regions/center", undefined, H);
      assertEquals(calls, 2, "a new address is geocoded again");
      assert(
        Math.abs(moved.body.lat - 39.74) < 0.25,
        JSON.stringify(moved.body),
      );
    } finally {
      geo.prototype.geocode = before;
    }
    assertEquals(
      (await call("GET", "/field/regions/center")).status,
      401,
      "signed out",
    );
  });
});

// REQ-365 — demo cycle 1, p15-17: "Miguel Torres · —" on /field/tasks
Deno.test("REQ-365 a one-off task for a customer with no subscription answers regionId and regionName empty, never a dash", async () => {
  await withServer(async (call) => {
    const H = await login(call, "+15125551365");
    const customer =
      (await call("POST", "/customers", { name: "Nobody Zoned" }, H)).body;
    const w = (await call("POST", "/field/workers", {
      name: "Miguel Torres",
      phoneNumber: "8435550365",
      pin: "1234",
    }, H)).body;
    const today = fieldToday();
    const made = await call("POST", "/field/tasks", {
      customerId: customer.id,
      date: today,
      taskTypeName: "Mulch",
      priceCents: 500,
      workerId: w.id,
    }, H);
    assertEquals(made.status, 201);
    assertEquals([made.body.regionId, made.body.regionName], ["", ""]);
    const day =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    const listed = day.find((t: { id: string }) => t.id === made.body.id);
    assertEquals([listed.workerName, listed.regionId, listed.regionName], [
      "Miguel Torres",
      "",
      "",
    ]);
  });
});

Deno.test("REQ-421 (demo cycle 2, m42) POST /field/workers answers a stable `code` for every refusal — the page words it; a cell already in use (any account) is worker_phone_taken", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const add = (b: Record<string, unknown>) =>
      call("POST", "/field/workers", b, H);
    const first = await add({
      name: "Pedro",
      phoneNumber: "8435550777",
      pin: "4321",
    });
    assertEquals(first.status, 201);
    const cases: [Record<string, unknown>, number, string][] = [
      [{ phoneNumber: "8435550776", pin: "1234" }, 400, "name_required"],
      [
        { name: "x".repeat(301), phoneNumber: "8435550776", pin: "1234" },
        400,
        "name_too_long",
      ],
      [
        { name: "A", phoneNumber: "843555", pin: "1234" },
        400,
        "phone_10_digits",
      ],
      [
        { name: "A", phoneNumber: "8435550776", pin: "12" },
        400,
        "pin_4_digits",
      ],
      [
        { name: "Dup", phoneNumber: "(843) 555-0777", pin: "0000" },
        409,
        "worker_phone_taken",
      ],
      [
        { name: "A", phoneNumber: "8435550776", pin: "1234", language: "fr" },
        400,
        "language_invalid",
      ],
    ];
    for (const [b, status, code] of cases) {
      const r = await add(b);
      assertEquals(r.status, status, `${code}: ${JSON.stringify(r.body)}`);
      assertEquals(r.body?.code, code, JSON.stringify(r.body));
    }
    // another account's crew holds the cell too (findByPhone is global) — the same code
    const H2 = await login(call, "+15125551401", "Other Owner");
    const other = await call("POST", "/field/workers", {
      name: "Dup",
      phoneNumber: "8435550777",
      pin: "0000",
    }, H2);
    assertEquals(other.status, 409);
    assertEquals(other.body?.code, "worker_phone_taken");
    // the row's own refusals on the same page: a bad language, a worker still covering a zone
    const badLang = await call("PUT", `/field/workers/${first.body.id}`, {
      language: "fr",
    }, H);
    assertEquals([badLang.status, badLang.body?.code], [
      400,
      "language_invalid",
    ]);
    const customer =
      (await call("POST", "/customers", { name: "Zone Owner" }, H)).body;
    const sub = (await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "900 Broadway St, Myrtle Beach, SC",
      items: [{ taskTypeName: "Cut", priceCents: 100 }],
    }, H)).body;
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: first.body.id,
    }, H);
    const covers = await call(
      "DELETE",
      `/field/workers/${first.body.id}`,
      undefined,
      H,
    );
    assertEquals([covers.status, covers.body?.code], [
      409,
      "worker_covers_zones",
    ]);
    assertEquals(covers.body?.detail?.zones, [sub.region.name]);
  });
});

Deno.test("REQ-401 (demo M30/m45, cycle 2) send to a customer with no email or phone fails with code noRecipient and sends nothing; the worker's lock reads 'draft' until the invoice is sent, then 'invoiced'", async () => {
  await withServer(async (call) => {
    const { H, W, customer, worker, sub, today } = await setUp(call);
    const johnson = (await call("POST", "/customers", { name: "Johnson" }, H))
      .body;
    assert(johnson?.id, JSON.stringify(johnson));
    const jSub = (await call("POST", "/field/subscriptions", {
      customerId: johnson.id,
      address: "6221 Forestbrook Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Repair 3 fence panels", priceCents: 9000 }],
    }, H)).body;
    if (jSub.region.id !== sub.region.id) {
      await call("PUT", `/field/regions/${jSub.region.id}/worker`, {
        workerId: worker.id,
      }, H);
    }
    for (
      const t of (await call(
        "GET",
        `/field/worker/tasks?date=${today}`,
        undefined,
        W,
      )).body
    ) {
      await call("POST", `/field/worker/tasks/${t.id}/complete`, {}, W);
    }
    const pulled = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals(pulled.status, 201, JSON.stringify(pulled.body));
    const inv = (id: string) =>
      pulled.body.invoices.find((i: { customerId: string }) =>
        i.customerId === id
      );
    const lockStates = async () =>
      ((await call("GET", `/field/worker/tasks?date=${today}`, undefined, W))
        .body as { customerId: string; locked: boolean; lockState: string }[])
        .map((t) =>
          [
            t.customerId === johnson.id ? "johnson" : "ana",
            t.locked,
            t.lockState,
          ].join(":")
        )
        .sort();
    assertEquals(await lockStates(), [
      "ana:true:draft",
      "ana:true:draft",
      "johnson:true:draft",
    ], "pulled onto a DRAFT: locked, but not 'invoiced'");
    // Johnson alone: nothing goes out, and the failure carries a code the page translates
    const none = await call("POST", `/field/batches/${pulled.body.id}/send`, {
      invoiceIds: [inv(johnson.id).id],
    }, H);
    assertEquals(none.status, 200, JSON.stringify(none.body));
    assertEquals(none.body.sent, 0);
    assertEquals(
      none.body.failed.map((
        f: { invoiceId: string; code?: string; customerId?: string },
      ) => [f.invoiceId, f.code, f.customerId]),
      [[inv(johnson.id).id, "noRecipient", johnson.id]],
    );
    // Ana's goes out: her tasks now read 'invoiced'; Johnson's stay on a draft
    const sent = await call("POST", `/field/batches/${pulled.body.id}/send`, {
      invoiceIds: [inv(customer.id).id],
    }, H);
    assertEquals([sent.body.sent, sent.body.failed], [1, []]);
    assertEquals(await lockStates(), [
      "ana:true:invoiced",
      "ana:true:invoiced",
      "johnson:true:draft",
    ]);
  });
});

Deno.test("REQ-747 GET /field/regions/center — demo-loop cycle 5 c4-m50: a business whose address is only its state (FL, as onboarding saves it) starts on Florida at a state-level zoom, not on Myrtle Beach", async () => {
  await withServer(async (call) => {
    const H = await login(call, "+15125551881");
    const put = await call("PUT", "/profile/address", {
      street: "",
      city: "",
      state: "FL",
      postal: "",
    }, H);
    assertEquals(put.status, 200, JSON.stringify(put.body));
    const at = await call("GET", "/field/regions/center", undefined, H);
    assertEquals(at.status, 200, JSON.stringify(at.body));
    assertEquals(at.body.source, "business");
    assert(
      at.body.lat > 24.4 && at.body.lat < 31.1 && at.body.lng > -87.7 &&
        at.body.lng < -79.9,
      `in Florida, not Myrtle Beach: ${JSON.stringify(at.body)}`,
    );
    assert(
      at.body.zoom >= 5 && at.body.zoom <= 7,
      `state-level zoom: ${JSON.stringify(at.body)}`,
    );
    // cached on the second read, same view
    const again = await call("GET", "/field/regions/center", undefined, H);
    assertEquals(again.body, at.body);
  });
});
