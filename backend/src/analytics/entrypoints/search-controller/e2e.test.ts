import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9092;

async function drain(res: Response) {
  await res.body?.cancel();
}

async function login(port: number, phone = "+15125551234"): Promise<string> {
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

Deno.test("search e2e: GET /search?q= returns [] for empty query", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const res = await fetch(`http://localhost:${PORT}/search?q=`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(res.results, []);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: GET /search?q=acme matches a customer name (case-insensitive)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    await drain(
      await fetch(`http://localhost:${PORT}/customers`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Acme Roofing", email: "ops@acme.test" }),
      }),
    );
    await drain(
      await fetch(`http://localhost:${PORT}/customers`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Beta Plumbing" }),
      }),
    );

    const res = await fetch(`http://localhost:${PORT}/search?q=ACME`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(res.results.length, 1);
    assertEquals(res.results[0].type, "customer");
    assertEquals(res.results[0].label, "Acme Roofing");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: GET /search?q=&type=quote narrows to one entity type", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    await drain(
      await fetch(`http://localhost:${PORT}/customers`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Roofing pros" }),
      }),
    );
    await drain(
      await fetch(`http://localhost:${PORT}/quotes`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          summary: "Roofing job",
          lineItems: [],
          status: "sent",
        }),
      }),
    );

    const all = await fetch(`http://localhost:${PORT}/search?q=roofing`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    const onlyQuote = await fetch(
      `http://localhost:${PORT}/search?q=roofing&type=quote`,
      {
        headers: { "x-session-id": sid },
      },
    ).then((r) => r.json());

    assertEquals(all.results.length, 2);
    assertEquals(onlyQuote.results.length, 1);
    assertEquals(onlyQuote.results[0].type, "quote");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: A's data and B's data are isolated", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    await drain(
      await fetch(`http://localhost:${PORT}/customers`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-session-id": sidA },
        body: JSON.stringify({ name: "Acme A" }),
      }),
    );

    const a = await fetch(`http://localhost:${PORT}/search?q=Acme`, {
      headers: { "x-session-id": sidA },
    }).then((r) => r.json());
    const b = await fetch(`http://localhost:${PORT}/search?q=Acme`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(a.results.length, 1);
    assertEquals(b.results.length, 0);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: GET /search?q= without session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/search?q=acme`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: invalid type filter is silently ignored", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(
      await fetch(`http://localhost:${PORT}/customers`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Acme" }),
      }),
    );
    const res = await fetch(
      `http://localhost:${PORT}/search?q=acme&type=bogus`,
      {
        headers: { "x-session-id": sid },
      },
    ).then((r) => r.json());
    assertEquals(res.results.length, 1);
    assertEquals(res.results[0].type, "customer");
  } finally {
    await server.stop();
    await resetKv();
  }
});

// ---- REQ-207: one box finds every document by number, customer, address or date ----

async function post(port: number, path: string, sid: string, body: unknown) {
  return await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

async function search(port: number, sid: string, q: string) {
  const res = await fetch(
    `http://localhost:${port}/search?q=${encodeURIComponent(q)}`,
    {
      headers: { "x-session-id": sid },
    },
  ).then((r) => r.json());
  return res.results as Array<{
    type: string;
    number: string;
    rank: number;
    url: string;
    customerName?: string;
    customerNumber?: string;
    amountCents?: number;
    status?: string;
    related: Array<{ type: string; number: string; url: string }>;
    counts?: { quotes: number; invoices: number };
  }>;
}

Deno.test("REQ-207 GET /search: 'inv-1', '742 ever', 'C-001', 'Q-1' and a date all find the records; rows carry customer, number, amount, status and related numbers; exact numbers rank first", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const zelda = await post(PORT, "/customers", sid, {
      name: "Zelda Ortiz",
      address: "742 Evergreen Terrace",
    });
    const other = await post(PORT, "/customers", sid, {
      name: "Barney Gumble",
      address: "1 Moe's Tavern",
    });
    const quote = await post(PORT, "/quotes", sid, {
      customerId: zelda.id,
      summary: "Roof repair",
      jobName: "Roof",
      lineItems: [],
      status: "sent",
      estimatedTotal: 150000,
    });
    const inv1 = await post(PORT, "/invoices", sid, {
      customerId: zelda.id,
      quoteId: quote.id,
      amount: 100000,
      status: "sent",
      issuedDate: "2026-10-14",
      dueDate: "2026-12-06",
      serviceDateFrom: "2026-10-20",
    });
    const inv2 = await post(PORT, "/invoices", sid, {
      customerId: other.id,
      amount: 500,
      status: "draft",
      issuedDate: "2026-03-05",
      dueDate: "2026-04-05",
    });
    const co = await post(PORT, `/invoices/${inv1.id}/change-orders`, sid, {
      description: "Add gutters",
      deltaAmountCents: 25000,
    });
    assertEquals([
      zelda.number,
      other.number,
      quote.number,
      inv1.number,
      inv2.number,
      co.number,
    ], ["C-001", "C-002", "Q-001", "INV-001", "INV-002", "CO-001"]);

    // a partial number, dash-insensitive: the invoice first, with everything a row needs
    const byNumber = await search(PORT, sid, "inv-1");
    assertEquals(byNumber[0].type, "invoice");
    assertEquals(byNumber[0].number, "INV-001");
    assertEquals(byNumber[0].rank, 0);
    assertEquals(byNumber[0].customerName, "Zelda Ortiz");
    assertEquals(byNumber[0].customerNumber, "C-001");
    assertEquals(byNumber[0].amountCents, 100000);
    assertEquals(byNumber[0].status, "sent");
    assertEquals(byNumber[0].url, `/invoices?open=${inv1.id}`);
    assertEquals(byNumber[0].related.map((r) => `${r.type}:${r.number}`), [
      "quote:Q-001",
      "changeOrder:CO-001",
    ]);
    assertEquals(byNumber[0].related[0].url, `/quotes?open=${quote.id}`);

    // the customer's address finds the customer and the invoice billed to them, not the other customer's
    const byAddress = await search(PORT, sid, "742 ever");
    const keys = byAddress.map((h) => `${h.type}:${h.number}`);
    assertEquals(keys.includes("customer:C-001"), true);
    assertEquals(keys.includes("invoice:INV-001"), true);
    assertEquals(keys.includes("invoice:INV-002"), false);
    assertEquals(keys.includes("customer:C-002"), false);

    // the customer number: the customer row first, with its counts
    const byCustomerNumber = await search(PORT, sid, "C-001");
    assertEquals(byCustomerNumber[0].type, "customer");
    assertEquals(byCustomerNumber[0].number, "C-001");
    assertEquals(byCustomerNumber[0].counts?.quotes, 1);
    assertEquals(byCustomerNumber[0].counts?.invoices, 1);

    // the quote: its row lists its invoice numbers
    const byQuote = await search(PORT, sid, "Q-1");
    assertEquals(byQuote[0].type, "quote");
    assertEquals(byQuote[0].number, "Q-001");
    assertEquals(byQuote[0].related.map((r) => r.number), [
      "INV-001",
      "CO-001",
    ]);

    // dates: ISO and "Oct 14" (issuedDate; createdAt is today, which any row may share)
    const byIso = await search(PORT, sid, "2026-10-20");
    assertEquals(byIso.map((h) => h.number), ["INV-001"]);
    const byWords = await search(PORT, sid, "Oct 14");
    assertEquals(byWords.some((h) => h.number === "INV-001"), true);
    assertEquals(byWords.some((h) => h.number === "INV-002"), false);

    // ranking: "INV-2" → INV-002 exactly, INV-001 is no hit — and a miss stays a miss
    const ranked = await search(PORT, sid, "INV-2");
    assertEquals(
      ranked.filter((h) => h.type === "invoice").map((h) => h.number),
      ["INV-002"],
    );
    assertEquals((await search(PORT, sid, "INV-9")).length, 0);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-207 GET /search never crosses accounts: B searching A's number, name or address gets nothing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const c = await post(PORT, "/customers", sidA, {
      name: "Zelda Ortiz",
      address: "742 Evergreen Terrace",
    });
    await post(PORT, "/invoices", sidA, {
      customerId: c.id,
      amount: 100,
      status: "sent",
    });
    assertEquals((await search(PORT, sidA, "INV-001")).length, 1);
    for (const q of ["INV-001", "C-001", "Zelda", "742 Evergreen"]) {
      assertEquals(
        (await search(PORT, sidB, q)).length,
        0,
        `B must not see A's "${q}"`,
      );
    }
  } finally {
    await server.stop();
    await resetKv();
  }
});

/**
 * REQ-713 — demo-loop cycle 5, issue m27: the Spanish topbar search read
 * "INV-002 … Programada 2026-11-29". Over HTTP, an invoice row now carries
 * its due/service days as typed fields for the client to spell in the page
 * language, and its free-text `sub` holds no ISO date.
 */
Deno.test("REQ-713 m27 GET /search: an invoice row's dates are typed fields, never ISO text in sub", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const ann = await post(PORT, "/customers", sid, { name: "Ann Lee" });
    await post(PORT, "/invoices", sid, {
      customerId: ann.id,
      amount: 10000,
      status: "sent",
      dueDate: "2026-11-29",
    });
    await post(PORT, "/invoices", sid, {
      customerId: ann.id,
      amount: 20000,
      status: "sent",
      dueDate: "2026-12-06",
      serviceDateFrom: "2026-11-20",
      serviceDateTo: "2026-11-22",
    });
    const rows = (await search(PORT, sid, "inv")) as Array<
      Record<string, unknown>
    >;
    const byNumber = (n: string) => rows.find((r) => r.number === n)!;
    assertEquals(byNumber("INV-001").dueDate, "2026-11-29");
    assertEquals(byNumber("INV-002").serviceFrom, "2026-11-20");
    assertEquals(byNumber("INV-002").serviceTo, "2026-11-22");
    for (const r of rows) {
      assertEquals(/\d{4}-\d{2}-\d{2}/.test(String(r.sub ?? "")), false);
    }
  } finally {
    await server.stop();
    await resetKv();
  }
});
