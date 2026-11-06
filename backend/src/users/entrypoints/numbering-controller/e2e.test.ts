/**
 * REQ-198 / REQ-199 — the account number, the starting numbers in Settings
 * (set once, locked after the first issue) and the setup reset that clears
 * test records and restarts numbering while keeping the account.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule] })
class TestApp {}

const PORT = 9471;
const BASE = `http://localhost:${PORT}`;
async function drain(res: Response) {
  await res.body?.cancel();
}
async function login(phone = "+15125550101"): Promise<string> {
  await drain(
    await fetch(`${BASE}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}
function auth(sid: string) {
  return { "content-type": "application/json", "x-session-id": sid };
}
async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}

Deno.test("REQ-198/199: GET /profile/numbering shows the account number, 001 defaults, nothing issued; GET /profile carries the account number", async () => {
  await withServer(async () => {
    const sid = await login();
    const view = await fetch(`${BASE}/profile/numbering`, {
      headers: auth(sid),
    }).then((r) => r.json());
    assertEquals(/^DM-\d{4}$/.test(view.accountNumber), true);
    assertEquals(view.next, {
      customer: "C-001",
      quote: "Q-001",
      invoice: "INV-001",
      changeOrder: "CO-001",
      workOrder: "WO-001",
    });
    assertEquals(view.locked, false);
    assertEquals(view.issued.invoice, false);
    const profile = await fetch(`${BASE}/profile`, { headers: auth(sid) }).then(
      (r) => r.json(),
    );
    assertEquals(profile.accountNumber, view.accountNumber);
    // a second account gets its own number
    const sid2 = await login("+15125550102");
    const view2 = await fetch(`${BASE}/profile/numbering`, {
      headers: auth(sid2),
    }).then((r) => r.json());
    assertEquals(view2.accountNumber !== view.accountNumber, true);
  });
});

Deno.test("REQ-199: starting numbers are honoured by the next document, and locked once that kind has issued", async () => {
  await withServer(async () => {
    const sid = await login();
    const set = await fetch(`${BASE}/profile/numbering`, {
      method: "PUT",
      headers: auth(sid),
      body: JSON.stringify({ invoiceStart: 5000, quoteStart: 1 }),
    });
    assertEquals(set.status, 200);
    const view = await set.json();
    assertEquals(view.next.invoice, "INV-5000");
    assertEquals(view.next.quote, "Q-001");
    const inv = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth(sid),
      body: JSON.stringify({ amount: 100 }),
    }).then((r) => r.json());
    assertEquals(inv.number, "INV-5000");
    assertEquals(inv.version, 1);
    const locked = await fetch(`${BASE}/profile/numbering`, {
      method: "PUT",
      headers: auth(sid),
      body: JSON.stringify({ invoiceStart: 9000 }),
    });
    assertEquals(locked.status, 409);
    assertEquals((await locked.json()).reason, "numbering_locked");
    // other kinds can still be set
    const ok = await fetch(`${BASE}/profile/numbering`, {
      method: "PUT",
      headers: auth(sid),
      body: JSON.stringify({ customerStart: 100 }),
    });
    assertEquals(ok.status, 200);
    const after = await ok.json();
    assertEquals(after.issued.invoice, true);
    assertEquals(after.locked, true);
    assertEquals(after.next.customer, "C-100");
    assertEquals(after.next.invoice, "INV-5001");
    // a bad value is a 4xx, not a 500
    const bad = await fetch(`${BASE}/profile/numbering`, {
      method: "PUT",
      headers: auth(sid),
      body: JSON.stringify({ quoteStart: 0 }),
    });
    assertEquals(bad.status >= 400 && bad.status < 500, true);
    await drain(bad);
  });
});

Deno.test("REQ-199: POST /me/setup-reset clears the account's records and counters, keeps the account, profile and session; another account is untouched", async () => {
  await withServer(async () => {
    const sid = await login();
    const other = await login("+15125550102");
    await drain(
      await fetch(`${BASE}/profile/identity`, {
        method: "PUT",
        headers: auth(sid),
        body: JSON.stringify({ businessName: "A2Z Services" }),
      }),
    );
    await drain(
      await fetch(`${BASE}/profile/numbering`, {
        method: "PUT",
        headers: auth(sid),
        body: JSON.stringify({ invoiceStart: 5000 }),
      }),
    );
    const customer = await fetch(`${BASE}/customers`, {
      method: "POST",
      headers: auth(sid),
      body: JSON.stringify({ name: "Test Co" }),
    }).then((r) => r.json());
    for (let i = 0; i < 3; i++) {
      await drain(
        await fetch(`${BASE}/invoices`, {
          method: "POST",
          headers: auth(sid),
          body: JSON.stringify({ amount: 100, customerId: customer.id }),
        }),
      );
    }
    await drain(
      await fetch(`${BASE}/invoices`, {
        method: "POST",
        headers: auth(other),
        body: JSON.stringify({ amount: 7 }),
      }),
    );
    const before = await fetch(`${BASE}/profile/numbering`, {
      headers: auth(sid),
    }).then((r) => r.json());
    assertEquals(before.next.invoice, "INV-5003");
    assertEquals(before.locked, true);

    const reset = await fetch(`${BASE}/me/setup-reset`, {
      method: "POST",
      headers: auth(sid),
    });
    assertEquals(reset.status, 200);
    assertEquals((await reset.json()).ok, true);

    // still signed in, profile intact, account number unchanged
    const profile = await fetch(`${BASE}/profile`, { headers: auth(sid) }).then(
      (r) => r.json(),
    );
    assertEquals(profile.identity?.businessName, "A2Z Services");
    assertEquals(profile.accountNumber, before.accountNumber);
    // records gone
    assertEquals(
      await fetch(`${BASE}/invoices`, { headers: auth(sid) }).then((r) =>
        r.json()
      ),
      [],
    );
    assertEquals(
      await fetch(`${BASE}/customers`, { headers: auth(sid) }).then((r) =>
        r.json()
      ),
      [],
    );
    // numbering restarts at the chosen start, and the start can be changed again
    const after = await fetch(`${BASE}/profile/numbering`, {
      headers: auth(sid),
    }).then((r) => r.json());
    assertEquals(after.locked, false);
    assertEquals(after.next.invoice, "INV-5000");
    const change = await fetch(`${BASE}/profile/numbering`, {
      method: "PUT",
      headers: auth(sid),
      body: JSON.stringify({ invoiceStart: 1 }),
    });
    assertEquals(change.status, 200);
    assertEquals((await change.json()).next.invoice, "INV-001");
    // the other account kept its invoice
    const theirs = await fetch(`${BASE}/invoices`, { headers: auth(other) })
      .then((r) => r.json());
    assertEquals(theirs.length, 1);
    assertEquals(theirs[0].number, "INV-001");
  });
});
