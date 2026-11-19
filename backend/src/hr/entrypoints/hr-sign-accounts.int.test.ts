/**
 * REQ-1156 (LOOP-007 q3-88) — the finished-signing screen must not promise accounts the
 * department does not have. GET /hr/sign/:token reports `accounts`, the number of accounts the
 * hire's provisioning plan will create (the department's systems snapshotted onto the hire), so
 * the phone page can pick honest done-screen copy. A department with no systems → accounts 0;
 * a department with one connected system → accounts 1.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { HrModule } from "@hr/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [HrModule] })
class TestApp {}
const PORT = 9156;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; text: string };
type Call = (
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersInit,
) => Promise<Res>;

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
    language: "es",
    email: "hr@example.com",
  }, H);
  await call("PUT", "/profile/identity", {
    businessName: "Monster Reservations Group",
  }, H);
  // keep the test quiet: no texts or emails go out
  await call("PUT", "/hr/settings", { autoSend: false }, H);
  return H;
}

async function hireInto(
  call: Call,
  H: Record<string, string>,
  name: string,
  systemIds: string[],
) {
  const doc = await call("POST", "/hr/documents", {
    name: `Handbook ${name}`,
    kind: "ack",
    contentHtml: "<p>Be kind.</p>",
  }, H);
  assertEquals(doc.status, 201, doc.text);
  const dept = await call("POST", "/hr/departments", {
    name,
    division: "outbound",
  }, H);
  assertEquals(dept.status, 201, dept.text);
  const cfg = await call("PUT", `/hr/departments/${dept.body.id}`, {
    docIds: [doc.body.id],
    systemIds,
  }, H);
  assertEquals(cfg.status, 200, cfg.text);
  const hire = await call("POST", "/hr/hires", {
    firstName: "Casey",
    lastName: "Lin",
    email: "casey.lin@example.com",
    phone: "(702) 555-1199",
    departmentId: dept.body.id,
  }, H);
  assertEquals(hire.status, 201, hire.text);
  return hire.body;
}

Deno.test("REQ-1156 (LOOP-007 q3-88): GET /hr/sign/:token for a department with no systems reports accounts 0", async () => {
  await withServer(async (call) => {
    const H = await login(call, "+15125551156");
    const hire = await hireInto(call, H, "Field crew", []);
    assertEquals(hire.systemIds, [], "the department has no systems");

    const pk = await call("GET", `/hr/sign/${hire.token}`);
    assertEquals(pk.status, 200, pk.text);
    assertEquals(
      pk.body.accounts,
      0,
      `REQ-1156: the sign packet says how many accounts are coming (0 here), got ${
        JSON.stringify(pk.body.accounts)
      } — keys: ${Object.keys(pk.body).join(",")}`,
    );
  });
});

Deno.test("REQ-1156 (LOOP-007 q3-88): GET /hr/sign/:token for a department with one system reports accounts 1", async () => {
  await withServer(async (call) => {
    const H = await login(call, "+15125551157");
    const crm = await call("POST", "/hr/systems", {
      name: "CRM",
      kind: "crm",
      desc: "Record of record",
    }, H);
    assertEquals(crm.status, 201, crm.text);
    const hire = await hireInto(call, H, "Activations", [crm.body.id]);
    assertEquals(hire.systemIds, [crm.body.id]);

    const pk = await call("GET", `/hr/sign/${hire.token}`);
    assertEquals(pk.status, 200, pk.text);
    assertEquals(
      pk.body.accounts,
      1,
      `REQ-1156: one connected system → accounts 1, got ${
        JSON.stringify(pk.body.accounts)
      }`,
    );
  });
});
