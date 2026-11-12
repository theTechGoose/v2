import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CommunicationModule } from "@communication/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { notificationTitle } from "#quote-flow/notification-title.ts";

@Module({ imports: [UsersModule, CommunicationModule] })
class TestApp {}

// Cross-module suite: a real Paperwork event must reach Notifications via
// the in-process EventBus singleton. AgentsModule transitively imports
// Users + Paperwork + Communication — that's the production wiring.
@Module({ imports: [AgentsModule] })
class CrossModuleApp {}

const PORT = 9080;

async function drain(res: Response) {
  await res.body?.cancel();
}

/** REQ-460: only a quote put in front of the customer is signed — POST
 *  /quotes makes a draft (NW-10), so a test sends it the API's way. */
async function markSent(port: number, sid: string, id: string) {
  await drain(
    await fetch(`http://localhost:${port}/quotes/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ status: "sent" }),
    }),
  );
}

async function login(
  port: number,
  phone = "+15125551234",
): Promise<{ sessionId: string; userId: string }> {
  await drain(
    await fetch(`http://localhost:${port}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  return await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
}

Deno.test("notifications e2e: list returns user's notifications newest-first", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const session = await login(PORT);
    // Seed via the store directly (the notify-on-event coordinator covers the EventBus integration test).
    const store = new NotificationStore();
    await store.create({
      userId: session.userId,
      type: "quote_sent",
      title: "First",
    });
    await new Promise((r) => setTimeout(r, 5));
    await store.create({
      userId: session.userId,
      type: "quote_sent",
      title: "Second",
    });

    const list = await fetch(`http://localhost:${PORT}/notifications`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());
    assertEquals(list.length, 2);
    assertEquals(list[0].title, "Second"); // newest-first
    assertEquals(list[1].title, "First");
  } finally {
    await server.stop();
    await resetKv();
  }
});

// REQ-496 (demo-loop cycle 3, m36): the topbar ticker re-renders a feed row
// in the LIVE UI language from the row's titleKey/titleParams, without a
// refetch. So GET /notifications must carry them, and the shared renderer
// fed the rows a Spanish viewer got must give exactly what the server says
// once the viewer is English.
Deno.test("REQ-496: GET /notifications carries titleKey/titleParams, and the shared renderer reproduces the server's title in the other language", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const session = await login(PORT);
    const auth = {
      "content-type": "application/json",
      "x-session-id": session.sessionId,
    };
    const store = new NotificationStore();
    await store.create({
      userId: session.userId,
      type: "invoice_paid",
      title: "stored",
      titleKey: "notify.invoice.paidAmount",
      titleParams: { name: "María Pérez", amountCents: 45000 },
    });
    await store.create({
      userId: session.userId,
      type: "invoice_claimed",
      title: "stored",
      titleKey: "notify.invoice.claimedVia",
      titleParams: { method: "zelle" },
    });
    const feedIn = async (language: "en" | "es") => {
      await drain(
        await fetch(`http://localhost:${PORT}/me`, {
          method: "PUT",
          headers: auth,
          body: JSON.stringify({ language }),
        }),
      );
      return await fetch(`http://localhost:${PORT}/notifications`, {
        headers: { "x-session-id": session.sessionId },
      }).then((r) => r.json());
    };
    const es = await feedIn("es");
    const paidEs = es.find((n: { type: string }) => n.type === "invoice_paid");
    assertEquals(paidEs.title, "María Pérez pagó $450");
    assertEquals(paidEs.titleKey, "notify.invoice.paidAmount");
    assertEquals(paidEs.titleParams, {
      name: "María Pérez",
      amountCents: 45000,
    });
    const en = await feedIn("en");
    for (const row of es) {
      const serverEn = en.find((n: { id: string }) => n.id === row.id);
      assertEquals(
        notificationTitle((k, v) => t("en", k, v), row),
        serverEn.title,
      );
      assertEquals(notificationTitle((k, v) => t("es", k, v), row), row.title);
    }
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("notifications e2e: GET /unread-count returns the bell number", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const session = await login(PORT);
    const store = new NotificationStore();
    await store.create({
      userId: session.userId,
      type: "quote_sent",
      title: "A",
    });
    await store.create({
      userId: session.userId,
      type: "quote_sent",
      title: "B",
    });
    const body = await fetch(
      `http://localhost:${PORT}/notifications/unread-count`,
      {
        headers: { "x-session-id": session.sessionId },
      },
    ).then((r) => r.json());
    assertEquals(body, { count: 2 });
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("notifications e2e: read-all clears unread count", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const session = await login(PORT);
    const store = new NotificationStore();
    await store.create({
      userId: session.userId,
      type: "quote_sent",
      title: "A",
    });
    await store.create({
      userId: session.userId,
      type: "quote_sent",
      title: "B",
    });

    await drain(
      await fetch(`http://localhost:${PORT}/notifications/read-all`, {
        method: "POST",
        headers: { "x-session-id": session.sessionId },
      }),
    );

    const after = await fetch(
      `http://localhost:${PORT}/notifications/unread-count`,
      {
        headers: { "x-session-id": session.sessionId },
      },
    ).then((r) => r.json());
    assertEquals(after, { count: 0 });
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("notifications e2e: cross-user notifications invisible", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const a = await login(PORT, "+15125551234");
    const b = await login(PORT, "+15125559999");
    const store = new NotificationStore();
    await store.create({ userId: a.userId, type: "quote_sent", title: "A's" });

    const bList = await fetch(`http://localhost:${PORT}/notifications`, {
      headers: { "x-session-id": b.sessionId },
    }).then((r) => r.json());
    assertEquals(bList, []);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("notifications e2e: GET without session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/notifications`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

// ---------------- cross-module suite ----------------

const X_PORT = 9094;

async function loginXmod(
  port: number,
  phone = "+15125551234",
): Promise<string> {
  await drain(
    await fetch(`http://localhost:${port}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function withCrossModuleServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(CrossModuleApp, {
    port: X_PORT,
    swagger: false,
  });
  await server.listen();
  try {
    await fn(X_PORT);
  } finally {
    await server.stop();
    await resetKv();
  }
}

Deno.test("cross-module e2e: customer accepts a quote → notification appears in /notifications", async () => {
  await withCrossModuleServer(async (port) => {
    const sid = await loginXmod(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    // P-59: /notifications now re-renders each title in the VIEWER's
    // language, so pin it to English — matching this test's fixed
    // assertion strings — instead of relying on whatever a fresh user's
    // default language happens to be.
    await drain(
      await fetch(`http://localhost:${port}/me`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ language: "en" }),
      }),
    );
    await drain(
      await fetch(`http://localhost:${port}/notifications`, {
        headers: { "x-session-id": sid },
      }),
    );

    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Acme Roofing" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        summary: "Roof tear-off",
        lineItems: [],
        status: "sent",
        estimatedTotal: 12_500,
      }),
    }).then((r) => r.json());
    await markSent(port, sid, quote.id);

    const accept = await fetch(
      `http://localhost:${port}/quotes/${quote.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Tom & Linda K.", signature: "data:..." }),
      },
    ).then((r) => r.json());
    assertEquals(accept.ok, true);

    const list = await fetch(`http://localhost:${port}/notifications`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assert(Array.isArray(list));
    const matching = list.filter((n: { type: string; entityId: string }) =>
      n.type === "quote_accepted" && n.entityId === quote.id
    );
    assertEquals(matching.length, 1);
    assertEquals(
      matching[0].title,
      // REQ-337: an intra-word hyphen keeps its compound whole ("Tear-off")
      "Acme Roofing accepted your quote for Roof Tear-off",
    );
  });
});

Deno.test("cross-module e2e: notification is scoped per-user — contractor B never sees A's events", async () => {
  await withCrossModuleServer(async (port) => {
    const sidA = await loginXmod(port, "+15125551234");
    const sidB = await loginXmod(port, "+15125559999");
    const authA = { "content-type": "application/json", "x-session-id": sidA };

    await drain(
      await fetch(`http://localhost:${port}/notifications`, {
        headers: { "x-session-id": sidA },
      }),
    );
    await drain(
      await fetch(`http://localhost:${port}/notifications`, {
        headers: { "x-session-id": sidB },
      }),
    );

    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: authA,
      body: JSON.stringify({ name: "A Co" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST",
      headers: authA,
      body: JSON.stringify({
        customerId: customer.id,
        summary: "x",
        lineItems: [],
        status: "sent",
      }),
    }).then((r) => r.json());
    await markSent(port, sidA, quote.id);
    await drain(
      await fetch(`http://localhost:${port}/quotes/${quote.id}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    const aList = await fetch(`http://localhost:${port}/notifications`, {
      headers: { "x-session-id": sidA },
    }).then((r) => r.json());
    const bList = await fetch(`http://localhost:${port}/notifications`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(
      aList.filter((n: { type: string }) => n.type === "quote_accepted").length,
      1,
    );
    assertEquals(
      bList.filter((n: { type: string }) => n.type === "quote_accepted").length,
      0,
    );
  });
});

Deno.test("REQ-224 cross-module e2e: claim by Zelle → confirm → the Spanish feed names the client, $450 and 'por Zelle'", async () => {
  await withCrossModuleServer(async (port) => {
    const sid = await loginXmod(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(
      await fetch(`http://localhost:${port}/me`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ language: "es" }),
      }),
    );
    // Materialize the singleton notifier before any event fires.
    await drain(
      await fetch(`http://localhost:${port}/notifications`, {
        headers: { "x-session-id": sid },
      }),
    );

    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "María Pérez" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        summary: "Cerca",
        lineItems: [],
      }),
    }).then((r) => r.json());
    const inv = await fetch(`http://localhost:${port}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        quoteId: quote.id,
        customerId: customer.id,
        dueDate: "2026-12-01",
        amount: 450_00,
        status: "sent",
      }),
    }).then((r) => r.json());

    const claim = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/claim-payment`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "zelle" }),
      },
    ).then((r) => r.json());
    assertEquals(claim.ok, true);
    const confirm = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/confirm-payment`,
      { method: "POST", headers: auth },
    ).then((r) => r.json());
    assertEquals(confirm.ok, true);

    const list = await fetch(`http://localhost:${port}/notifications`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json()) as Array<{ type: string; title: string }>;
    const titles = list.map((n) => `${n.type}: ${n.title}`);
    assert(
      titles.includes(
        "invoice_claimed: María Pérez dice que pagó por Zelle — confirma que lo recibiste",
      ),
      titles.join("\n"),
    );
    assert(
      titles.includes("invoice_paid: María Pérez pagó $450"),
      titles.join("\n"),
    );
  });
});

Deno.test("REQ-488 cross-module e2e: claim by Zelle → 'Didn't get it' → the feed's newest row says not received, the claim row is read, /public carries the rejection until a new claim", async () => {
  await withCrossModuleServer(async (port) => {
    const sid = await loginXmod(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(
      await fetch(`http://localhost:${port}/me`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ language: "es" }),
      }),
    );
    await drain(
      await fetch(`http://localhost:${port}/notifications`, {
        headers: { "x-session-id": sid },
      }),
    );
    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Maria Lopez" }),
    }).then((r) => r.json());
    const inv = await fetch(`http://localhost:${port}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        dueDate: "2026-12-01",
        amount: 250_00,
        status: "sent",
      }),
    }).then((r) => r.json());
    const claim = (body: unknown) =>
      fetch(`http://localhost:${port}/invoices/${inv.id}/claim-payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    assertEquals((await claim({ method: "zelle" })).ok, true);
    await new Promise((r) => setTimeout(r, 5));
    const rej = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/reject-claim`,
      { method: "POST", headers: auth },
    ).then((r) => r.json());
    assertEquals(rej.ok, true);

    const list = await fetch(`http://localhost:${port}/notifications`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json()) as Array<
      { type: string; title: string; read: boolean; entityId?: string }
    >;
    assertEquals(
      list[0].title,
      "Marcaste el pago de Maria Lopez por Zelle como no recibido",
      list.map((n) => n.title).join("\n"),
    );
    assertEquals(list[0].entityId, inv.id);
    const claimed = list.find((n) => n.type === "invoice_claimed")!;
    assertEquals(claimed.read, true, "the stale claim row is closed");

    // the customer's /i learns the claim was not received
    const pub = await fetch(`http://localhost:${port}/invoices/${inv.id}/public`)
      .then((r) => r.json());
    assertEquals(pub.status, "sent");
    assert(typeof pub.claimRejectedAt === "string", JSON.stringify(pub));
    assertEquals(pub.claimRejectedMethod, "zelle");

    // a fresh claim clears the marker
    assertEquals((await claim({ method: "check" })).ok, true);
    const pub2 = await fetch(`http://localhost:${port}/invoices/${inv.id}/public`)
      .then((r) => r.json());
    assertEquals(pub2.status, "claimed");
    assertEquals(pub2.claimRejectedAt, undefined);
    assertEquals(pub2.claimRejectedMethod, undefined);
  });
});
