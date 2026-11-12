/**
 * REQ-200..205 over HTTP — versions, pending revisions, publish, locks,
 * stale-version guards, balances and the quote ledger.
 */
import "#reflect-metadata";
import { assertEquals, assertNotEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 9472;
const BASE = `http://localhost:${PORT}`;
async function drain(res: Response) {
  await res.body?.cancel();
}
async function login(phone = "+15125550201"): Promise<string> {
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
  // the sender needs a name for the send paths
  await drain(
    await fetch(`${BASE}/me`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-session-id": v.sessionId,
      },
      body: JSON.stringify({ name: "Rafa Castro" }),
    }),
  );
  return v.sessionId;
}
function auth(sid: string) {
  return { "content-type": "application/json", "x-session-id": sid };
}
const json = { "content-type": "application/json" };
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
async function post(
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function put(
  path: string,
  headers: Record<string, string>,
  body: unknown,
) {
  return await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}
async function get(path: string, headers: Record<string, string> = {}) {
  return await fetch(`${BASE}${path}`, { headers }).then((r) => r.json());
}
async function mkCustomer(sid: string, name = "Ann Lee") {
  return await post("/customers", auth(sid), {
    name,
    email: "ann@example.com",
    address: "1 Main St",
  }).then((r) => r.json());
}
async function mkQuote(
  sid: string,
  customerId: string,
  extra: Record<string, unknown> = {},
) {
  return await post("/quotes", auth(sid), {
    summary: "Roof replacement",
    customerId,
    lineItems: [{
      description: "Shingles",
      quantity: 1,
      unit: "job",
      price: 100000,
    }],
    estimatedTotal: 100000,
    ...extra,
  }).then((r) => r.json());
}

Deno.test("REQ-200: a retried POST /invoices with the same Idempotency-Key makes one invoice", async () => {
  await withServer(async () => {
    const sid = await login();
    const headers = { ...auth(sid), "idempotency-key": "abc-1" };
    const [a, b] = await Promise.all([
      post("/invoices", headers, { amount: 100 }).then((r) => r.json()),
      post("/invoices", headers, { amount: 100 }).then((r) => r.json()),
    ]);
    assertEquals(a.id, b.id);
    assertEquals((await get("/invoices", auth(sid))).length, 1);
    // body requestId works the same
    const c = await post("/quotes", auth(sid), {
      summary: "A",
      lineItems: [],
      requestId: "q-1",
    }).then((r) => r.json());
    const d = await post("/quotes", auth(sid), {
      summary: "A",
      lineItems: [],
      requestId: "q-1",
    }).then((r) => r.json());
    assertEquals(c.id, d.id);
    assertEquals(c.number, "Q-001");
  });
});

Deno.test("REQ-201: a draft edits live; a sent quote's edit waits as a pending revision; publish advances the version on the same link and files the old one", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id);
    assertEquals(q.number, "Q-001");
    assertEquals(q.version, 1);
    // draft: live edit
    const draftEdit = await put(`/quotes/${q.id}`, auth(sid), {
      estimatedTotal: 110000,
    }).then((r) => r.json());
    assertEquals(draftEdit.estimatedTotal, 110000);
    assertEquals(draftEdit.version, 1);
    // issue it
    await drain(
      await put(`/quotes/${q.id}`, auth(sid), {
        status: "sent",
        sentAt: new Date().toISOString(),
      }),
    );
    // issued: content edit is pending, live unchanged
    const pending = await put(`/quotes/${q.id}`, auth(sid), {
      estimatedTotal: 120000,
    }).then((r) => r.json());
    assertEquals(pending.estimatedTotal, 110000);
    assertEquals(pending.pendingRevision?.estimatedTotal, 120000);
    assertEquals(pending.version, 1);
    const pub = await get(`/quotes/${q.id}/public`);
    assertEquals(
      pub.estimatedTotal,
      110000,
      "the customer still sees the published version",
    );
    assertEquals(pub.number, "Q-001");
    assertEquals(pub.version, 1);
    // publish
    const published = await post(`/quotes/${q.id}/publish`, auth(sid), {
      notify: false,
    }).then((r) => r.json());
    assertEquals(published.version, 2);
    assertEquals(published.estimatedTotal, 120000);
    assertEquals(published.pendingRevision, undefined);
    assertEquals(published.number, "Q-001");
    const pub2 = await get(`/quotes/${q.id}/public`);
    assertEquals(pub2.estimatedTotal, 120000);
    assertEquals(pub2.version, 2);
    const versions = await get(`/quotes/${q.id}/versions`, auth(sid));
    assertEquals(versions.map((v: { version: number }) => v.version), [1, 2]);
    assertEquals(versions[0].content.estimatedTotal, 110000);
    assertEquals(versions[1].current, true);
    assertEquals(versions[1].publishedBy.userId !== undefined, true);
    // nothing pending → 409
    const nothing = await post(`/quotes/${q.id}/publish`, auth(sid), {});
    assertEquals(nothing.status, 409);
    await drain(nothing);
    // a send publishes what is pending first: the link the customer gets shows what was sent
    await drain(
      await put(`/quotes/${q.id}`, auth(sid), { estimatedTotal: 130000 }),
    );
    const sent = await post(`/quotes/${q.id}/email`, auth(sid), {
      to: "ops@acme.test",
    }).then((r) => r.json());
    assertEquals(sent.ok, true);
    const afterSend = await get(`/quotes/${q.id}`, auth(sid));
    assertEquals(afterSend.version, 3);
    assertEquals(afterSend.estimatedTotal, 130000);
    assertEquals(afterSend.pendingRevision, undefined);
    assertEquals((await get(`/quotes/${q.id}/public`)).estimatedTotal, 130000);
  });
});

Deno.test("REQ-202/203: signing carries the version — a stale version is refused, two concurrent signatures yield one, and a signed quote is locked", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id);
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));
    await drain(
      await put(`/quotes/${q.id}`, auth(sid), { summary: "Roof v2" }),
    );
    await drain(
      await post(`/quotes/${q.id}/publish`, auth(sid), { notify: false }),
    );
    // the customer's page was loaded at version 1
    const stale = await post(`/quotes/${q.id}/accept`, json, {
      name: "Ann",
      version: 1,
    });
    assertEquals(stale.status, 409);
    const staleBody = await stale.json();
    assertEquals(staleBody.reason, "stale_version");
    assertEquals(staleBody.currentVersion, 2);
    // five concurrent signatures at the current version → exactly one wins
    const results = await Promise.all(
      Array.from(
        { length: 5 },
        (_, i) =>
          post(`/quotes/${q.id}/accept`, json, {
            name: `Ann ${i}`,
            version: 2,
          }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    assertEquals(statuses, [200, 409, 409, 409, 409]);
    await Promise.all(results.map(drain));
    const signed = await get(`/quotes/${q.id}`, auth(sid));
    assertEquals(signed.status, "accepted");
    assertEquals(signed.version, 2);
    // locked: content edits are refused with locked_signed
    const locked = await put(`/quotes/${q.id}`, auth(sid), {
      estimatedTotal: 5,
    });
    assertEquals(locked.status, 409);
    assertEquals((await locked.json()).reason, "locked_signed");
    // the public document says accepted and signed, at that version, with the signature
    const pub = await get(`/quotes/${q.id}/public`);
    assertEquals(pub.state, "accepted");
    assertEquals(pub.version, 2);
    assertEquals(typeof pub.acceptedAt, "string");
  });
});

Deno.test("REQ-202/203: an invoice has one balance — a stale claim is refused, partial payments count down, overpayment is flagged, paid is locked", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const inv = await post("/invoices", auth(sid), {
      customerId: c.id,
      amount: 100000,
      status: "sent",
    }).then((r) => r.json());
    assertEquals(inv.number, "INV-001");
    const pub = await get(`/invoices/${inv.id}/public`);
    assertEquals(pub.balanceCents, 100000);
    assertEquals(pub.paidCents, 0);
    assertEquals(pub.version, 1);
    assertEquals(pub.number, "INV-001");
    // contractor records a partial payment of 40000
    await drain(
      await post("/payments", auth(sid), {
        invoiceId: inv.id,
        amount: 40000,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
    );
    const afterPartial = await get(`/invoices/${inv.id}`, auth(sid));
    assertEquals(afterPartial.paidCents, 40000);
    assertEquals(afterPartial.status !== "paid", true);
    assertEquals(afterPartial.paidAt, undefined);
    const pub2 = await get(`/invoices/${inv.id}/public`);
    assertEquals(pub2.balanceCents, 60000);
    // a customer page still showing the full amount cannot claim it
    const stale = await post(`/invoices/${inv.id}/claim-payment`, json, {
      method: "zelle",
      amountCents: 100000,
      version: 1,
    });
    assertEquals(stale.status, 409);
    const staleBody = await stale.json();
    assertEquals(staleBody.reason, "stale_balance");
    assertEquals(staleBody.balanceCents, 60000);
    // a claim at the current balance is accepted for the balance, and confirming it closes the bill
    const ok = await post(`/invoices/${inv.id}/claim-payment`, json, {
      method: "zelle",
      amountCents: 60000,
      version: 1,
    });
    assertEquals(ok.status, 200);
    await drain(ok);
    const claimed = await get(`/invoices/${inv.id}`, auth(sid));
    assertEquals(claimed.paymentIntent.amount, 60000);
    const confirm = await post(
      `/invoices/${inv.id}/confirm-payment`,
      auth(sid),
    );
    assertEquals(confirm.status, 200);
    await drain(confirm);
    const paid = await get(`/invoices/${inv.id}`, auth(sid));
    assertEquals(paid.status, "paid");
    assertEquals(paid.paidCents, 100000);
    assertEquals(paid.overpaidCents, undefined);
    // paid is locked
    for (
      const attempt of [
        put(`/invoices/${inv.id}`, auth(sid), { amount: 5 }),
        post(`/invoices/${inv.id}/discount`, auth(sid), { discountCents: 100 }),
        post(`/invoices/${inv.id}/change-orders`, auth(sid), {
          description: "x",
          deltaAmountCents: 100,
        }),
        fetch(`${BASE}/invoices/${inv.id}`, {
          method: "DELETE",
          headers: auth(sid),
        }),
      ]
    ) {
      const r = await attempt;
      assertEquals(r.status, 409);
      assertEquals((await r.json()).reason, "locked_paid");
    }
    // an extra payment on a paid invoice is an overpayment, flagged
    await drain(
      await post("/payments", auth(sid), {
        invoiceId: inv.id,
        amount: 500,
        method: "cash",
        receivedAt: new Date().toISOString(),
      }),
    );
    const over = await get(`/invoices/${inv.id}`, auth(sid));
    assertEquals(over.overpaidCents, 500);
    assertEquals(over.status, "paid");
  });
});

Deno.test("REQ-201/202: a discount or an approved change order publishes a new version of the invoice; a paid invoice's change order cannot be approved", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const inv = await post("/invoices", auth(sid), {
      customerId: c.id,
      amount: 100000,
      status: "sent",
    }).then((r) => r.json());
    const discounted = await post(`/invoices/${inv.id}/discount`, auth(sid), {
      discountCents: 10000,
    }).then((r) => r.json());
    assertEquals(discounted.amount, 90000);
    assertEquals(discounted.version, 2);
    const co = await post(`/invoices/${inv.id}/change-orders`, auth(sid), {
      description: "Add gutters",
      deltaAmountCents: 20000,
    }).then((r) => r.json());
    assertEquals(co.number, "CO-001");
    const coPub = await get(`/change-orders/${co.id}/public`);
    assertEquals(coPub.number, "CO-001");
    assertEquals(coPub.invoice?.number, "INV-001");
    assertEquals(coPub.invoice?.url, `/i/${inv.id}`);
    const approve = await post(`/change-orders/${co.id}/approve`, json, {
      name: "Ann Lee",
    });
    assertEquals(approve.status, 200);
    await drain(approve);
    const after = await get(`/invoices/${inv.id}`, auth(sid));
    assertEquals(after.amount, 110000);
    assertEquals(after.version, 3);
    const versions = await get(`/invoices/${inv.id}/versions`, auth(sid));
    assertEquals(versions.map((v: { version: number }) => v.version), [
      1,
      2,
      3,
    ]);
    assertEquals(versions[0].content.amount, 100000);
    assertEquals(versions[1].content.amount, 90000);
    assertEquals(versions[2].publishedBy.customer, true);
    // the public invoice lists the approved change order with its number
    const pub = await get(`/invoices/${inv.id}/public`);
    assertEquals(pub.changeOrders?.length, 1);
    assertEquals(pub.changeOrders[0].number, "CO-001");
    assertEquals(pub.changeOrders[0].status, "approved");
    // pay it, then a new change order cannot be approved
    await drain(
      await post("/payments", auth(sid), {
        invoiceId: inv.id,
        amount: 110000,
        method: "cash",
        receivedAt: new Date().toISOString(),
      }),
    );
    const second = await post(`/invoices/${inv.id}/change-orders`, auth(sid), {
      description: "More",
      deltaAmountCents: 1,
    });
    assertEquals(second.status, 409);
    await drain(second);
  });
});

Deno.test("REQ-205: GET /quotes/:id/ledger — invoices with numbers and statuses, approved change orders in the agreed total, remaining-to-invoice apart from invoiced-unpaid", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id, {
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
    });
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));
    const accept = await post(`/quotes/${q.id}/accept`, json, {
      name: "Ann",
      version: 1,
    });
    assertEquals(accept.status, 200);
    await drain(accept);
    const ledger1 = await get(`/quotes/${q.id}/ledger`, auth(sid));
    assertEquals(ledger1.quote.number, "Q-001");
    assertEquals(ledger1.agreementTotalCents, 100000);
    assertEquals(ledger1.invoices.length, 2, "50/50 terms bill two milestones");
    assertEquals(ledger1.invoices.map((i: { number: string }) => i.number), [
      "INV-001",
      "INV-002",
    ]);
    assertEquals(
      ledger1.invoices.map((i: { installmentIndex: number }) =>
        i.installmentIndex
      ),
      [1, 2],
      "numbers follow the milestone order",
    );
    assertEquals(ledger1.invoicedCents, 100000);
    assertEquals(ledger1.remainingToInvoiceCents, 0);
    assertEquals(ledger1.invoicedUnpaidCents, 100000);
    // a change order on the first invoice, approved → agreed total grows, remaining to invoice grows
    const first = ledger1.invoices[0];
    const co = await post(`/invoices/${first.id}/change-orders`, auth(sid), {
      description: "Extra",
      deltaAmountCents: 20000,
    }).then((r) => r.json());
    await drain(
      await post(`/change-orders/${co.id}/approve`, json, { name: "Ann" }),
    );
    // pay the first invoice in full
    const firstNow = await get(`/invoices/${first.id}`, auth(sid));
    await drain(
      await post("/payments", auth(sid), {
        invoiceId: first.id,
        amount: firstNow.amount,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
    );
    const ledger2 = await get(`/quotes/${q.id}/ledger`, auth(sid));
    assertEquals(ledger2.approvedChangeOrdersCents, 20000);
    assertEquals(ledger2.agreementTotalCents, 120000);
    assertEquals(
      ledger2.invoicedCents,
      120000,
      "the approved change order is on INV-001",
    );
    assertEquals(ledger2.paidCents, 70000);
    assertEquals(ledger2.invoicedUnpaidCents, 50000);
    assertEquals(ledger2.remainingToInvoiceCents, 0);
    assertEquals(ledger2.changeOrders[0].number, "CO-001");
    assertEquals(ledger2.changeOrders[0].invoiceNumber, "INV-001");
    assertEquals(ledger2.invoices[0].status, "paid");
    assertEquals(ledger2.invoices[0].url, `/i/${first.id}`);
    // the public invoice links back to the signed quote by number, and lists its siblings by number
    const pub = await get(`/invoices/${first.id}/public`);
    assertEquals(pub.quote?.number, "Q-001");
    assertEquals(pub.quote?.url, `/q/${q.id}`);
    assertEquals(pub.quote?.accepted, true);
    assertEquals(pub.siblings.map((s: { number: string }) => s.number), [
      "INV-001",
      "INV-002",
    ]);
    // the public quote lists its invoices with balances
    const pubQ = await get(`/quotes/${q.id}/public`);
    assertEquals(pubQ.invoices.map((i: { number: string }) => i.number), [
      "INV-001",
      "INV-002",
    ]);
    assertEquals(pubQ.invoices[1].balanceCents, 50000);
    assertNotEquals(pubQ.invoices[0].url, undefined);
  });
});

Deno.test("REQ-204: editing the customer after a quote was sent does not change what the customer's link shows; the customer's own number travels along", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid, "Ann Lee");
    assertEquals(c.number, "C-001");
    const q = await mkQuote(sid, c.id);
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));
    await drain(
      await put(`/customers/${c.id}`, auth(sid), {
        name: "Ann Lee-Smith",
        address: "9 Oak Ave",
      }),
    );
    const pub = await get(`/quotes/${q.id}/public`);
    assertEquals(pub.customer.name, "Ann Lee");
    assertEquals(pub.customer.number, "C-001");
    // a draft still follows the live customer
    const draft = await mkQuote(sid, c.id);
    const pubDraft = await get(`/quotes/${draft.id}/public`);
    assertEquals(pubDraft.customer.name, "Ann Lee-Smith");
  });
});

Deno.test("REQ-248: version 1 names who published it and when — issued by PUT, revised by a send, and a pre-stamp row read back with its owner", async () => {
  await withServer(async () => {
    const sid = await login();
    const me = await get(`/me`, auth(sid));
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id);
    // issued through PUT /quotes/:id (the quotes panel's path)
    const issued = await put(`/quotes/${q.id}`, auth(sid), {
      status: "sent",
    }).then((r) => r.json());
    assertEquals(issued.publishedAt, issued.sentAt);
    assertEquals(issued.publishedBy?.userId, me.id);
    let versions = await get(`/quotes/${q.id}/versions`, auth(sid));
    assertEquals(versions.length, 1);
    assertEquals(versions[0].publishedBy, {
      userId: me.id,
      name: "Rafa Castro",
    });
    assertEquals(versions[0].publishedAt, issued.sentAt);
    // a pending edit, published by a send: both versions name the publisher
    await drain(
      await put(`/quotes/${q.id}`, auth(sid), { estimatedTotal: 120000 }),
    );
    const sent = await post(`/quotes/${q.id}/email`, auth(sid), {
      to: "ops@acme.test",
    }).then((r) => r.json());
    assertEquals(sent.ok, true);
    versions = await get(`/quotes/${q.id}/versions`, auth(sid));
    assertEquals(versions.map((v: { version: number }) => v.version), [1, 2]);
    for (const v of versions) {
      assertEquals(v.publishedBy, { userId: me.id, name: "Rafa Castro" });
    }
    assertEquals(versions[0].publishedAt, issued.sentAt);
    assertNotEquals(versions[0].publishedBy, {});
    // a row issued before the stamp existed (no publishedAt / publishedBy)
    const old = await mkQuote(sid, c.id);
    await drain(
      await put(`/quotes/${old.id}`, auth(sid), { status: "sent" }),
    );
    const kv = await getKv();
    const row = (await kv.get<Record<string, unknown>>(["quote", old.id]))
      .value!;
    delete row.publishedAt;
    delete row.publishedBy;
    await kv.set(["quote", old.id], row);
    const legacy = await get(`/quotes/${old.id}/versions`, auth(sid));
    assertEquals(legacy[0].publishedBy, { userId: me.id, name: "Rafa Castro" });
    assertEquals(legacy[0].publishedAt, row.sentAt);
  });
});
