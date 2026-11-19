/**
 * REQ-932 (LOOP-007 q1-18) — a hire's packet can never be empty. POST /hr/hires into a
 * department with no documents (or whose only document was discarded) is refused with
 * 409 packet_empty: no hire is stored and no text or email goes out. POST /hr/hires/:id/send on
 * a legacy hire whose packet is already empty is refused the same way.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { HrModule } from "@hr/mod-root.ts";
import { HireStore } from "@hr/domain/data/hr-stores/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [HrModule] })
class TestApp {}
const PORT = 9932;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; text: string };
type Call = (
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersInit,
) => Promise<Res>;

/** the dev-mode SMS and email services print what they would send; the test reads it */
function captureLog() {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes(":dev-mode]")) lines.push(line);
    else orig(...args);
  };
  return { lines, restore: () => (console.log = orig) };
}

async function withServer(fn: (call: Call) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("DENO_DEPLOYMENT_ID");
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
    return { status: r.status, body: parsed, text };
  };
  try {
    await fn(call);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(call: Call, phone: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", {
    name: "Raphael Castro",
    language: "en",
    email: "hr@example.com",
  }, H);
  await call("PUT", "/profile/identity", {
    businessName: "Monster Reservations Group",
  }, H);
  return H;
}

const sent = (lines: string[]) =>
  lines.filter((l) =>
    l.includes("[sms:dev-mode]") || l.includes("[email:dev-mode]")
  );

Deno.test("REQ-932 (q1-18): POST /hr/hires into a department with no documents is 409 packet_empty — nothing stored, nothing sent", async () => {
  const log = captureLog();
  try {
    await withServer(async (call) => {
      const H = await login(call, "+15125559320");
      const s = await call("GET", "/hr/settings", undefined, H);
      assertEquals(s.body.autoSend, true, "autoSend is on by default");
      const crew = await call("POST", "/hr/departments", {
        name: "Field crew",
        division: "outbound",
      }, H);
      assertEquals(crew.status, 201, crew.text);
      assertEquals(crew.body.docIds, []);

      log.lines.length = 0;
      const r = await call("POST", "/hr/hires", {
        firstName: "Casey",
        lastName: "Lin",
        email: "casey.lin@example.com",
        phone: "(702) 555-1199",
        departmentId: crew.body.id,
      }, H);
      assertEquals(
        r.status,
        409,
        `an empty packet is refused, got ${r.status}: ${r.text}`,
      );
      assertEquals(r.body.code, "packet_empty");
      assertEquals(
        sent(log.lines),
        [],
        "no text and no email went out for an empty packet",
      );
      const roster = await call("GET", "/hr/hires", undefined, H);
      assertEquals(roster.body, [], "no hire was stored");
    });
  } finally {
    log.restore();
  }
});

Deno.test("REQ-932 (q1-18): POST /hr/hires into a department whose only document was discarded is 409 packet_empty", async () => {
  const log = captureLog();
  try {
    await withServer(async (call) => {
      const H = await login(call, "+15125559321");
      const doc = await call("POST", "/hr/documents", {
        name: "Handbook",
        kind: "ack",
        contentHtml: "<p>Be kind.</p>",
      }, H);
      assertEquals(doc.status, 201, doc.text);
      const dept = await call("POST", "/hr/departments", {
        name: "Inbound",
        division: "inbound",
      }, H);
      const cfg = await call("PUT", `/hr/departments/${dept.body.id}`, {
        docIds: [doc.body.id],
      }, H);
      assertEquals(cfg.status, 200, cfg.text);
      assertEquals(
        (await call("DELETE", `/hr/documents/${doc.body.id}`, undefined, H))
          .status,
        200,
      );

      log.lines.length = 0;
      const r = await call("POST", "/hr/hires", {
        firstName: "Dani",
        phone: "7025551188",
        email: "dani@example.com",
        departmentId: dept.body.id,
      }, H);
      assertEquals(
        r.status,
        409,
        `a packet of only discarded docs is empty, got ${r.status}: ${r.text}`,
      );
      assertEquals(r.body.code, "packet_empty");
      assertEquals(sent(log.lines), [], "nothing was sent");
      assertEquals(
        (await call("GET", "/hr/hires", undefined, H)).body,
        [],
        "no hire was stored",
      );
    });
  } finally {
    log.restore();
  }
});

Deno.test("REQ-932 (q1-18): POST /hr/hires/:id/send on a legacy hire with an empty packet is 409 packet_empty and sends nothing", async () => {
  const log = captureLog();
  try {
    await withServer(async (call) => {
      const H = await login(call, "+15125559322");
      const doc = await call("POST", "/hr/documents", {
        name: "Offer Letter",
        kind: "sign",
        contentHtml: "<p>Offer.</p>",
      }, H);
      const dept = await call("POST", "/hr/departments", {
        name: "Sales",
        division: "inbound",
      }, H);
      await call("PUT", `/hr/departments/${dept.body.id}`, {
        docIds: [doc.body.id],
      }, H);
      const hire = await call("POST", "/hr/hires", {
        firstName: "Marcus",
        phone: "7025551100",
        email: "marcus@example.com",
        departmentId: dept.body.id,
      }, H);
      assertEquals(hire.status, 201, hire.text);
      // a hire created before the guard existed: its frozen packet is empty
      const store = new HireStore();
      const rec = await store.get(hire.body.id);
      assert(rec, "the hire is stored");
      await store.put({ ...rec, packet: [] });

      log.lines.length = 0;
      const r = await call("POST", `/hr/hires/${hire.body.id}/send`, {}, H);
      assertEquals(
        r.status,
        409,
        `an empty packet is never re-sent, got ${r.status}: ${r.text}`,
      );
      assertEquals(r.body.code, "packet_empty");
      assertEquals(sent(log.lines), [], "no text and no email on resend");
    });
  } finally {
    log.restore();
  }
});
