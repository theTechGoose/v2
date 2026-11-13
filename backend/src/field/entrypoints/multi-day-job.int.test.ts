/**
 * REQ-785 — demo-loop cycle dv1, issue d11 (first seen cycle 3, M42): "A job that runs several
 * days can be scheduled as one job". The field area only had subscriptions, zones and rounds, so a
 * 3-day job took three one-off tasks. Raphael: "Yes, multi-day jobs."
 *
 * Over HTTP, in process on an in-memory KV: a one-off task (REQ-164) takes a last day (`endDate`,
 * or a number of `days`) and more workers (`crewIds`). It stays ONE record. It lists on every day
 * it covers, on the office's day and on each worker's screen. The office can change its days. It
 * is done once for the whole job and bills once.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { FieldModule } from "@field/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9785;
const J = { "content-type": "application/json" };

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; headers: Headers };
type Call = (
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersInit,
) => Promise<Res>;
type Row = Record<string, unknown> & { id: string };

/** a 2xx answer — the message carries the body when it is not */
function ok(r: Res): Res {
  assert(
    r.status >= 200 && r.status < 300,
    `${r.status} ${JSON.stringify(r.body)}`,
  );
  return r;
}

async function withServer(
  fn: (call: Call, texts: SendSmsInput[]) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  const texts: SendSmsInput[] = [];
  app.get(SmsService).send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true });
  };
  await app.listen(PORT);
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
    return { status: r.status, body: parsed, headers: r.headers };
  };
  try {
    await fn(call, texts);
  } finally {
    await app.close();
    await resetKv();
  }
}

/** the owner (texts on), a customer, Luis (the lead) and Pedro (the crew), both signed in on /worker */
async function crew(call: Call, phone: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name: "Field Owner", language: "en" }, H);
  const me = await call("GET", "/me", undefined, H);
  await new UserStore().setFeature(me.body.id, "fieldTexts", true);
  const customer = (await call("POST", "/customers", {
    name: "Dana Whitfield",
    address: "12 Fence Row, Myrtle Beach, SC",
    phoneNumber: "+18435550799",
  }, H)).body;
  const worker = async (name: string, cell: string) => {
    const w = (await call("POST", "/field/workers", {
      name,
      phoneNumber: cell,
      pin: "1234",
      language: "en",
    }, H)).body;
    const login = await call("POST", "/field/worker/login", {
      phoneNumber: cell,
      pin: "1234",
    });
    ok(login);
    return {
      ...w,
      cookie: { cookie: login.headers.get("set-cookie")!.split(";")[0] },
    };
  };
  // a textable cell (REQ-523: never 555-01XX), one per test
  const luis = await worker("Luis", `843555${phone.slice(-2)}01`);
  const pedro = await worker("Pedro", `843555${phone.slice(-2)}02`);
  return { H, customer, luis, pedro, today: fieldToday() };
}

const fence = (customerId: string, extra: Record<string, unknown>) => ({
  customerId,
  taskTypeName: "Fence install",
  priceCents: 240000,
  ...extra,
});

Deno.test("REQ-785 (demo dv1-d11) a 3-day fence install posted as ONE job lists on each of its 3 days, for the office and for both of its workers, and not the day before or after", async () => {
  await withServer(async (call) => {
    const { H, customer, luis, pedro, today } = await crew(
      call,
      "+15125557851",
    );
    const d = (n: number) => shiftDate(today, n);
    const made = await call(
      "POST",
      "/field/tasks",
      fence(customer.id, {
        date: d(0),
        endDate: d(2),
        workerId: luis.id,
        crewIds: [pedro.id],
      }),
      H,
    );
    assertEquals(made.status, 201, JSON.stringify(made.body));
    assertEquals(
      [
        made.body.oneOff,
        made.body.date,
        made.body.endDate,
        made.body.workerId,
        made.body.crewIds,
        made.body.crewNames,
      ],
      [true, d(0), d(2), luis.id, [pedro.id], ["Pedro"]],
    );
    const job = made.body.id as string;

    const office = async (day: string) =>
      ((await call("GET", `/field/tasks?date=${day}`, undefined, H))
        .body as Row[]).filter((t) => t.id === job);
    const onScreen = async (cookie: HeadersInit, day: string) =>
      ((await call(
        "GET",
        `/field/worker/tasks?date=${day}`,
        undefined,
        cookie,
      )).body as Row[]).filter((t) => t.id === job);

    assertEquals((await office(d(-1))).length, 0, "not the day before");
    for (const n of [0, 1, 2]) {
      assertEquals(
        (await office(d(n))).length,
        1,
        `the office sees it once on day ${n + 1}`,
      );
      const mine = await onScreen(luis.cookie, d(n));
      assertEquals(mine.length, 1, `Luis sees it on day ${n + 1}`);
      assertEquals(
        "priceCents" in mine[0],
        false,
        "no price on a worker's screen",
      );
      assertEquals(
        (await onScreen(pedro.cookie, d(n))).length,
        1,
        `Pedro, on the crew, sees it on day ${n + 1}`,
      );
    }
    assertEquals((await office(d(3))).length, 0, "not the day after");
    assertEquals((await onScreen(luis.cookie, d(3))).length, 0);

    // "or a number of days": 3 days from tomorrow ends the day after tomorrow + 1
    const byDays = await call(
      "POST",
      "/field/tasks",
      fence(customer.id, { date: d(1), days: 3, workerId: luis.id }),
      H,
    );
    assertEquals([byDays.status, byDays.body.endDate], [201, d(3)]);
    // a one-day one-off stays one day: no endDate
    const single = await call(
      "POST",
      "/field/tasks",
      fence(customer.id, { date: d(1), endDate: d(1), workerId: luis.id }),
      H,
    );
    assertEquals([single.status, single.body.endDate], [201, undefined]);
  });
});

Deno.test("REQ-785 the office edits the job's days: it leaves the days it no longer covers and lands on the new ones; a last day before the first or past 31 days is 400; a subscription visit's day is not editable", async () => {
  await withServer(async (call) => {
    const { H, customer, luis, pedro, today } = await crew(
      call,
      "+15125557852",
    );
    const d = (n: number) => shiftDate(today, n);
    const job = (await call(
      "POST",
      "/field/tasks",
      fence(customer.id, { date: d(0), endDate: d(2), workerId: luis.id }),
      H,
    )).body.id as string;
    const days = async () => {
      const out: number[] = [];
      for (let n = -1; n <= 5; n++) {
        const rows =
          (await call("GET", `/field/tasks?date=${d(n)}`, undefined, H))
            .body as Row[];
        if (rows.some((t) => t.id === job)) out.push(n);
      }
      return out;
    };
    assertEquals(await days(), [0, 1, 2]);

    const moved = await call(
      "PUT",
      `/field/tasks/${job}`,
      { date: d(1), endDate: d(3), crewIds: [pedro.id] },
      H,
    );
    ok(moved);
    assertEquals(
      [moved.body.date, moved.body.endDate, moved.body.crewNames],
      [d(1), d(3), ["Pedro"]],
    );
    assertEquals(await days(), [1, 2, 3], "one day later, still 3 days");

    // the last day alone: a 5-day job
    await call("PUT", `/field/tasks/${job}`, { endDate: d(5) }, H);
    assertEquals(await days(), [1, 2, 3, 4, 5]);
    // no last day: back to one day
    const one = await call("PUT", `/field/tasks/${job}`, { endDate: null }, H);
    assertEquals(ok(one).body.endDate, undefined);
    assertEquals(await days(), [1]);

    // refusals
    const before = await call(
      "PUT",
      `/field/tasks/${job}`,
      { date: d(3), endDate: d(2) },
      H,
    );
    assertEquals(before.status, 400, "a last day before the first");
    assertEquals(
      (await call(
        "POST",
        "/field/tasks",
        fence(customer.id, { date: d(0), endDate: d(31), workerId: luis.id }),
        H,
      )).status,
      400,
      "32 days is too long",
    );
    assertEquals(
      (await call(
        "POST",
        "/field/tasks",
        fence(customer.id, { date: d(0), endDate: d(30), workerId: luis.id }),
        H,
      )).status,
      201,
      "31 days is fine",
    );
    assertEquals(
      (await call(
        "PUT",
        `/field/tasks/${job}`,
        { crewIds: ["nobody"] },
        H,
      )).status,
      400,
      "a crew of unknown workers",
    );
    // a subscription's visit belongs to its schedule
    const sub = (await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "12 Fence Row, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Cut", priceCents: 6500 }],
    }, H)).body;
    await call(
      "PUT",
      `/field/regions/${sub.region.id}/worker`,
      { workerId: luis.id },
      H,
    );
    const visit =
      ((await call("GET", `/field/tasks?date=${today}`, undefined, H))
        .body as Row[]).find((t) => t.subscriptionId === sub.id)!;
    assertEquals(
      (await call(
        "PUT",
        `/field/tasks/${visit.id}`,
        { date: d(1), endDate: d(2) },
        H,
      )).status,
      400,
      "a subscription visit's days are its schedule's",
    );
  });
});

Deno.test("REQ-785 done once for the whole job: Pedro (crew) checks it off on day 1 and it reads complete on all 3 days for the office and for Luis; it bills as ONE line naming its days; a multi-day job is never deferred", async () => {
  await withServer(async (call) => {
    const { H, customer, luis, pedro, today } = await crew(
      call,
      "+15125557853",
    );
    const d = (n: number) => shiftDate(today, n);
    const job = (await call(
      "POST",
      "/field/tasks",
      fence(customer.id, {
        date: d(0),
        endDate: d(2),
        workerId: luis.id,
        crewIds: [pedro.id],
      }),
      H,
    )).body.id as string;

    const done = await call(
      "POST",
      `/field/worker/tasks/${job}/complete`,
      {},
      pedro.cookie,
    );
    assertEquals(ok(done).body.status, "complete");
    for (const n of [0, 1, 2]) {
      const office =
        ((await call("GET", `/field/tasks?date=${d(n)}`, undefined, H))
          .body as Row[]).find((t) => t.id === job);
      assertEquals(office?.status, "complete", `office, day ${n + 1}`);
      const lead = ((await call(
        "GET",
        `/field/worker/tasks?date=${d(n)}`,
        undefined,
        luis.cookie,
      )).body as Row[]).find((t) => t.id === job);
      assertEquals(lead?.status, "complete", `Luis, day ${n + 1}`);
    }

    // a second job, open: a worker's "defer to tomorrow" does not apply to a job of several days
    const open = (await call(
      "POST",
      "/field/tasks",
      fence(customer.id, { date: d(0), endDate: d(1), workerId: luis.id }),
      H,
    )).body.id as string;
    const defer = await call(
      "POST",
      `/field/worker/tasks/${open}/defer`,
      { note: "rain" },
      luis.cookie,
    );
    assertEquals(defer.status, 409, JSON.stringify(defer.body));
    const still =
      ((await call("GET", `/field/tasks?date=${d(1)}`, undefined, H))
        .body as Row[]).filter((t) => t.taskTypeName === "Fence install");
    assertEquals(
      still.map((t) => [t.id, t.status]).sort(),
      [[job, "complete"], [open, "assigned"]].sort(),
      "nothing was deferred or copied",
    );

    // one invoice line for the 3-day job — a pull over its last day alone finds it too
    const pull = await call(
      "POST",
      "/field/batches/pull",
      { from: d(2), to: d(2) },
      H,
    );
    assertEquals(pull.status, 201, JSON.stringify(pull.body));
    assertEquals(pull.body.invoices.length, 1);
    const inv = pull.body.invoices[0];
    assertEquals(inv.amount, 240000);
    assertEquals(inv.lineItems.length, 1, "ONE line, not one per day");
    const short = (iso: string) =>
      `${
        new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
          month: "short",
          timeZone: "UTC",
        })
      } ${Number(iso.slice(8))}`;
    assert(
      inv.lineItems[0].description.startsWith(
        `${short(d(0))} – ${short(d(2))} — Fence install`,
      ),
      inv.lineItems[0].description,
    );
    assertEquals([inv.serviceDateFrom, inv.serviceDateTo], [d(0), d(2)]);
    // billed once: the next pull over its days finds nothing
    const again = await call(
      "POST",
      "/field/batches/pull",
      { from: d(0), to: d(2) },
      H,
    );
    assertEquals(again.body.invoices.length, 0);
  });
});

Deno.test("REQ-785 a plain worker may check off a job that started 4 days ago and ends today (the window counts from its last day); a job on today texts every worker on it, once; a note stays on its own job", async () => {
  await withServer(async (call, texts) => {
    const { H, customer, luis, pedro, today } = await crew(
      call,
      "+15125557854",
    );
    const d = (n: number) => shiftDate(today, n);
    const long = (await call(
      "POST",
      "/field/tasks",
      fence(customer.id, { date: d(-4), endDate: d(0), workerId: luis.id }),
      H,
    )).body.id as string;
    const done = await call(
      "POST",
      `/field/worker/tasks/${long}/complete`,
      {},
      luis.cookie,
    );
    assertEquals(ok(done).body.status, "complete");

    const before = texts.length;
    const crewJob = await call(
      "POST",
      "/field/tasks",
      fence(customer.id, {
        date: d(0),
        endDate: d(2),
        workerId: luis.id,
        crewIds: [pedro.id],
      }),
      H,
    );
    assertEquals(crewJob.body.texted, true);
    const sent = texts.slice(before).map((x) => x.to).sort();
    assertEquals(
      sent,
      ["+1" + luis.phoneNumber, "+1" + pedro.phoneNumber].sort(),
      "the lead and the crew hear once each",
    );

    // another customer's one-off that starts the same day keeps its own note
    const other = (await call("POST", "/customers", { name: "Sam Lee" }, H))
      .body;
    const mulch = (await call("POST", "/field/tasks", {
      customerId: other.id,
      date: d(0),
      taskTypeName: "Mulch",
      priceCents: 500,
      workerId: luis.id,
    }, H)).body.id as string;
    const noted = await call(
      "POST",
      `/field/worker/tasks/${crewJob.body.id}/note`,
      { note: "Posts set, rails tomorrow" },
      luis.cookie,
    );
    ok(noted);
    const rows = (await call("GET", `/field/tasks?date=${d(0)}`, undefined, H))
      .body as Row[];
    assertEquals(
      rows.find((t) => t.id === crewJob.body.id)?.note,
      "Posts set, rails tomorrow",
    );
    assertEquals(
      rows.find((t) => t.id === mulch)?.note,
      undefined,
      "the note did not land on Sam's mulch",
    );
  });
});
