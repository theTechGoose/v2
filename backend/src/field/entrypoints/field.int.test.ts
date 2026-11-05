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
    assertEquals(ok.body, { id: made.body.id, name: "Pedro", role: "foreman" });
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
