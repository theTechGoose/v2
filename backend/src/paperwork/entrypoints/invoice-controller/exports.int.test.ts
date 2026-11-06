/**
 * REQ-208 — the CSV exports (invoices all/paid/unpaid, customers) over HTTP.
 * REQ-209 — 300 invoices on one account: numbering has no gaps or
 * duplicates (50 of them created concurrently), and the list, the search,
 * the export and the quote's ledger each answer in under a second.
 *
 * The records are written through the stores (not HTTP) so the test stays
 * fast; the reads are real HTTP.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { CreateInvoiceDto } from "@paperwork/dto/invoice.ts";
import { matchesDocNumber } from "#documents/numbering.ts";
import {
  CUSTOMER_EXPORT_HEADER,
  INVOICE_EXPORT_HEADER,
} from "#documents/exports.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9481;
const BASE = `http://localhost:${PORT}`;

async function drain(res: Response) {
  await res.body?.cancel();
}

async function login(
  phone = "+15125551234",
): Promise<{ sid: string; userId: string }> {
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
  const profile = await fetch(`${BASE}/profile`, {
    headers: { "x-session-id": v.sessionId },
  }).then((r) => r.json());
  return { sid: v.sessionId, userId: profile.user.id };
}

async function timed<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - t0);
  console.log(`[REQ-209] ${label}: ${ms} ms`);
  return { value, ms };
}

async function csv(
  sid: string,
  path: string,
): Promise<
  {
    status: number;
    type: string;
    disposition: string;
    bom: boolean;
    lines: string[];
  }
> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-session-id": sid },
  });
  // read the bytes: `text()` and TextDecoder both strip a BOM, and the BOM is the point
  const bytes = new Uint8Array(await res.arrayBuffer());
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    disposition: res.headers.get("content-disposition") ?? "",
    bom,
    lines: new TextDecoder().decode(bytes).split("\r\n"),
  };
}

/** One CSV line → its cells (RFC 4180: quoted cells may hold commas; "" is a quote). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  const src = line.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

Deno.test("REQ-208 GET /invoices/export.csv?status=all|paid|unpaid and GET /customers/export.csv: the agreed columns, dollars, ISO dates, BOM; the legacy ?year= stays paid-only; a bad status is 400; nothing crosses accounts", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sid, userId } = await login();
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    const cos = new ChangeOrderStore();
    const zelda = await customers.create(userId, {
      name: "Zelda Ortiz",
      businessName: "Ortiz, Inc.",
      email: "zelda@example.com",
      phoneNumber: "+15125550199",
      address: "742 Evergreen Terrace",
    });
    const nobody = await customers.create(userId, { name: "Nobody Home" });
    const quote = await quotes.create(userId, {
      customerId: zelda.id,
      summary: "Roof",
      lineItems: [],
      status: "sent",
      estimatedTotal: 150000,
    });
    const sent = await invoices.create(userId, {
      customerId: zelda.id,
      quoteId: quote.id,
      amount: 110000,
      subtotalCents: 100000,
      discountCents: 5000,
      taxCents: 15000,
      status: "sent",
      issuedDate: "2026-10-14",
      dueDate: "2026-11-13",
      serviceAddress: "9 Oak Ave",
      serviceDateFrom: "2026-10-20",
      serviceDateTo: "2026-10-22",
    });
    await cos.create(userId, sent.id, {
      description: "Gutters",
      deltaAmountCents: 25000,
      quoteId: quote.id,
    });
    const paid = await invoices.create(userId, {
      customerId: zelda.id,
      amount: 50000,
      status: "paid",
      paidAt: "2026-09-30T15:00:00.000Z",
      issuedDate: "2026-09-01",
      dueDate: "2026-09-30",
    });
    await invoices.create(userId, {
      customerId: nobody.id,
      amount: 700,
      status: "draft",
      issuedDate: "2026-03-05",
      dueDate: "2026-04-05",
    });

    // all: header + 3 rows, the agreed columns, the BOM, the file name
    const all = await csv(sid, "/invoices/export.csv?status=all");
    assertEquals(all.status, 200);
    assert(all.type.includes("text/csv"), all.type);
    assert(all.disposition.includes("invoices-all.csv"), all.disposition);
    assert(
      all.bom,
      "starts with the UTF-8 BOM (EF BB BF) so Excel reads accents",
    );
    assertEquals(cells(all.lines[0]), [...INVOICE_EXPORT_HEADER]);
    assertEquals(all.lines.length, 4);
    const sentRow = all.lines.find((l) => l.startsWith("INV-001,"))!;
    assertEquals(cells(sentRow).slice(0, 24), [
      "INV-001",
      "1",
      "sent",
      "C-001",
      "Zelda Ortiz",
      "Ortiz, Inc.",
      "zelda@example.com",
      "+15125550199",
      "742 Evergreen Terrace",
      "9 Oak Ave",
      "2026-10-20",
      "2026-10-22",
      "Q-001",
      "CO-001",
      "2026-10-14",
      "2026-11-13",
      "",
      "1000.00",
      "50.00",
      "150.00",
      "1100.00",
      "0.00",
      "1100.00",
      "0.00",
    ]);
    assert(
      sentRow.includes('"Ortiz, Inc."'),
      "the business name with a comma is quoted",
    );
    assert(
      sentRow.endsWith(`/i/${sent.id}`),
      `the link column is the public invoice link (${sentRow.slice(-60)})`,
    );
    const paidRow = all.lines.find((l) => l.startsWith("INV-002,"))!;
    const paidCells = cells(paidRow);
    assertEquals(paidCells[2], "paid");
    assertEquals(paidCells.slice(14, 17), [
      "2026-09-01",
      "2026-09-30",
      "2026-09-30",
    ], "issued, due, paid on");
    assertEquals(paidCells.slice(17, 24), [
      "",
      "0.00",
      "0.00",
      "500.00",
      "500.00",
      "0.00",
      "0.00",
    ], "subtotal, discount, tax, total, paid, balance, overpaid");

    // paid / unpaid
    const paidOnly = await csv(sid, "/invoices/export.csv?status=paid");
    assertEquals(paidOnly.lines.length, 2);
    assert(paidOnly.lines[1].startsWith("INV-002,"), paidOnly.lines[1]);
    const unpaid = await csv(sid, "/invoices/export.csv?status=unpaid");
    assertEquals(
      unpaid.lines.length,
      2,
      "unpaid = issued and open: the sent one, not the draft",
    );
    assert(unpaid.lines[1].startsWith("INV-001,"), unpaid.lines[1]);
    assert(
      unpaid.disposition.includes("invoices-unpaid.csv"),
      unpaid.disposition,
    );

    // the legacy tax export: paid in that year, same columns now
    const legacy = await csv(sid, "/invoices/export.csv?year=2026");
    assertEquals(legacy.lines.length, 2);
    assert(legacy.lines[1].startsWith("INV-002,"), legacy.lines[1]);
    assertEquals(cells(legacy.lines[0]), [...INVOICE_EXPORT_HEADER]);
    assertEquals(
      (await csv(sid, "/invoices/export.csv?year=2026&month=9")).lines.length,
      2,
    );
    assertEquals(
      (await csv(sid, "/invoices/export.csv?year=2026&month=8")).lines.length,
      1,
    );

    // a bad status
    const bad = await fetch(`${BASE}/invoices/export.csv?status=bogus`, {
      headers: { "x-session-id": sid },
    });
    assertEquals(bad.status, 400);
    await drain(bad);

    // customers
    const cust = await csv(sid, "/customers/export.csv");
    assertEquals(cust.status, 200);
    assert(cust.type.includes("text/csv"), cust.type);
    assert(cust.disposition.includes("customers.csv"), cust.disposition);
    assert(cust.bom, "the customers file starts with the BOM too");
    assertEquals(cells(cust.lines[0]), [...CUSTOMER_EXPORT_HEADER]);
    assertEquals(cust.lines.length, 3);
    const zRow = cells(cust.lines[1]);
    assertEquals(zRow.slice(0, 6), [
      "C-001",
      "Zelda Ortiz",
      "Ortiz, Inc.",
      "zelda@example.com",
      "+15125550199",
      "742 Evergreen Terrace",
    ]);
    assertEquals(
      zRow[6],
      new Date().toISOString().slice(0, 10),
      "created today",
    );
    assertEquals(zRow.slice(7), ["Q-001", "INV-001 INV-002", "1100.00"]);
    const nRow = cells(cust.lines[2]);
    assertEquals(nRow.slice(0, 6), ["C-002", "Nobody Home", "", "", "", ""]);
    assertEquals(nRow.slice(7), ["", "INV-003", "0.00"]);

    // another account sees only the headers
    const { sid: sidB } = await login("+15125559999");
    assertEquals(
      (await csv(sidB, "/invoices/export.csv?status=all")).lines.length,
      1,
    );
    assertEquals((await csv(sidB, "/customers/export.csv")).lines.length, 1);
    // and no session is refused
    const anon = await fetch(`${BASE}/customers/export.csv`);
    assertEquals(anon.ok, false);
    await drain(anon);
    assertEquals(paid.number, "INV-002");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-209 300 invoices on one account: INV-001…INV-300 with no gaps or duplicates (50 created concurrently); GET /invoices lists 300, /search?q=INV-2, /invoices/export.csv?status=all (301 lines) and /quotes/:id/ledger each answer in < 1 s", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sid, userId } = await login();
    const headers = { "x-session-id": sid };
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    const zelda = await customers.create(userId, {
      name: "Zelda Ortiz",
      address: "742 Evergreen Terrace",
    });
    const quote = await quotes.create(userId, {
      customerId: zelda.id,
      summary: "Roof",
      lineItems: [],
      status: "accepted",
      estimatedTotal: 300 * 10000,
    });
    // every third one is paid, written the way the balance coordinator leaves it (paidCents + paidAt)
    const body = (i: number): CreateInvoiceDto => ({
      customerId: zelda.id,
      quoteId: quote.id,
      amount: 10000,
      status: i % 3 === 0 ? "paid" : "sent",
      ...(i % 3 === 0
        ? { paidAt: "2026-10-01T12:00:00.000Z", paidCents: 10000 }
        : {}),
      issuedDate: "2026-10-14",
      dueDate: "2026-11-13",
      jobName: `Visit ${i}`,
    } as CreateInvoiceDto);

    const seeded = await timed(
      "create 250 invoices in sequence + 50 concurrently (store)",
      async () => {
        for (let i = 1; i <= 250; i++) await invoices.create(userId, body(i));
        await Promise.all(
          Array.from(
            { length: 50 },
            (_, k) => invoices.create(userId, body(251 + k)),
          ),
        );
        return await invoices.listByUser(userId);
      },
    );
    const numbers = seeded.value.map((i) => i.number!).sort();
    const expected = Array.from(
      { length: 300 },
      (_, i) => `INV-${String(i + 1).padStart(3, "0")}`,
    ).sort();
    assertEquals(numbers.length, 300);
    assertEquals(new Set(numbers).size, 300, "no duplicate numbers");
    assertEquals(numbers, expected, "INV-001…INV-300 with no gaps");

    const list = await timed(
      "GET /invoices",
      () => fetch(`${BASE}/invoices`, { headers }).then((r) => r.json()),
    );
    assertEquals(list.value.length, 300);
    assert(list.ms < 1000, `GET /invoices took ${list.ms} ms`);

    const search = await timed(
      "GET /search?q=INV-2&limit=50",
      () =>
        fetch(`${BASE}/search?q=INV-2&limit=50`, { headers }).then((r) =>
          r.json()
        ),
    );
    assert(search.ms < 1000, `GET /search took ${search.ms} ms`);
    const rows = search.value.results as Array<
      { type: string; number: string; rank: number }
    >;
    const invoiceRows = rows.filter((r) => r.type === "invoice");
    assertEquals(
      invoiceRows[0].number,
      "INV-002",
      "the exact match comes first",
    );
    assertEquals(invoiceRows[0].rank, 0);
    assertEquals(invoiceRows.length, 50, "the per-type cap");
    assert(
      invoiceRows.every((r) => matchesDocNumber(r.number, "INV-2")),
      "every row names INV-2",
    );
    assert(
      invoiceRows.slice(1, 11).every((r) => r.rank === 1),
      "prefix matches (INV-020…, INV-200…) follow the exact one",
    );
    assertEquals(invoiceRows.slice(1, 11).map((r) => r.number), [
      "INV-020",
      "INV-021",
      "INV-022",
      "INV-023",
      "INV-024",
      "INV-025",
      "INV-026",
      "INV-027",
      "INV-028",
      "INV-029",
    ]);

    const exported = await timed(
      "GET /invoices/export.csv?status=all",
      () => csv(sid, "/invoices/export.csv?status=all"),
    );
    assert(exported.ms < 1000, `export took ${exported.ms} ms`);
    assertEquals(exported.value.lines.length, 301, "header + 300 rows");
    assertEquals(
      exported.value.lines.filter((l) => l.startsWith("INV-")).length,
      300,
    );

    const ledger = await timed(
      "GET /quotes/:id/ledger",
      () =>
        fetch(`${BASE}/quotes/${quote.id}/ledger`, { headers }).then((r) =>
          r.json()
        ),
    );
    assert(ledger.ms < 1000, `ledger took ${ledger.ms} ms`);
    assertEquals(ledger.value.invoices.length, 300);
    assertEquals(ledger.value.invoicedCents, 300 * 10000);
    assertEquals(ledger.value.paidCents, 100 * 10000);
    assertEquals(ledger.value.invoices[0].number, "INV-001");
    assertEquals(ledger.value.invoices[299].number, "INV-300");
  } finally {
    await server.stop();
    await resetKv();
  }
});
