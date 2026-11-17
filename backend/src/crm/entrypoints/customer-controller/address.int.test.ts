/**
 * REQ-625 — POST/PUT /customers carry the address in parts (street, city,
 * state, zip) alongside notes and the business name; the stored record keeps
 * the composed `address` every other reader uses, and an edit is read back at
 * once by GET /customers/:id and the list.
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
const PORT = 9625;
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
async function login(port: number, phone = "+15125556251"): Promise<string> {
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

Deno.test("REQ-625 POST /customers — the full customer: parts, composed address, notes, business", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({
        name: "Maria Lopez",
        businessName: "Lopez Properties",
        phoneNumber: "+44 20 7946 0958",
        email: "maria@lopez.example",
        street: "4410 Ranch Rd",
        city: "Austin",
        state: "TX",
        zip: "78735",
        notes: "Gate code 4411; dog in back yard",
      }),
    });
    assertEquals(res.status < 300, true);
    const c = await res.json();
    assertEquals(c.street, "4410 Ranch Rd");
    assertEquals(c.city, "Austin");
    assertEquals(c.state, "TX");
    assertEquals(c.zip, "78735");
    assertEquals(c.address, "4410 Ranch Rd, Austin, TX 78735");
    assertEquals(c.notes, "Gate code 4411; dog in back yard");
    assertEquals(c.businessName, "Lopez Properties");
    // REQ-625: any phone format is kept as typed
    assertEquals(c.phoneNumber, "+44 20 7946 0958");
  });
});

Deno.test("REQ-625 PUT /customers/:id — editing the parts recomposes the address; GET and the list read it at once", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const h = { ...J, "x-session-id": sid };
    const created = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        name: "Maria Lopez",
        street: "4410 Ranch Rd",
        city: "Austin",
        state: "TX",
        zip: "78735",
      }),
    }).then((r) => r.json());

    const put = await fetch(
      `http://localhost:${port}/customers/${created.id}`,
      {
        method: "PUT",
        headers: h,
        body: JSON.stringify({
          name: "Maria L. Lopez",
          street: "88 Creek Bend",
          city: "Round Rock",
          zip: "78664",
          notes: "Mow every other Friday",
          email: "",
        }),
      },
    );
    assertEquals(put.status < 300, true);
    const updated = await put.json();
    assertEquals(updated.name, "Maria L. Lopez");
    assertEquals(updated.address, "88 Creek Bend, Round Rock, TX 78664");
    assertEquals(updated.state, "TX");
    assertEquals(updated.notes, "Mow every other Friday");
    assertEquals(updated.number, created.number); // the C- number never changes

    const got = await fetch(
      `http://localhost:${port}/customers/${created.id}`,
      {
        headers: { "x-session-id": sid },
      },
    ).then((r) => r.json());
    assertEquals(got.address, "88 Creek Bend, Round Rock, TX 78664");
    assertEquals(got.city, "Round Rock");

    const list = await fetch(`http://localhost:${port}/customers`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(
      list.find((c: { id: string }) => c.id === created.id).address,
      "88 Creek Bend, Round Rock, TX 78664",
    );
  });
});

Deno.test("REQ-625 PUT /customers/:id — a legacy free-text address still writes, and a non-string part is refused", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const h = { ...J, "x-session-id": sid };
    const created = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        name: "Old style",
        street: "1 Main",
        city: "Waco",
      }),
    }).then((r) => r.json());
    const legacy = await fetch(
      `http://localhost:${port}/customers/${created.id}`,
      {
        method: "PUT",
        headers: h,
        body: JSON.stringify({ address: "9 Elm Rd, Dallas" }),
      },
    ).then((r) => r.json());
    assertEquals(legacy.address, "9 Elm Rd, Dallas");
    assertEquals(legacy.street, undefined);
    assertEquals(legacy.city, undefined);

    const bad = await fetch(
      `http://localhost:${port}/customers/${created.id}`,
      {
        method: "PUT",
        headers: h,
        body: JSON.stringify({ zip: 78701 }),
      },
    );
    await bad.body?.cancel();
    assertEquals(bad.ok, false);
  });
});
