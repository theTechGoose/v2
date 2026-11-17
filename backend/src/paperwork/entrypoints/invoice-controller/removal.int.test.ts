/**
 * REQ-627 — removing an invoice, with a clear process, enforced by the server:
 * never sent → DELETE; sent or paid-into → void (kept, Cancelled, payments
 * stay); paid → neither; "void & duplicate" for a corrected copy; bulk.
 * REQ-629 — POST /invoices/pdf-batch: one PDF, each invoice on its own pages.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { pdfFacts } from "@paperwork/domain/business/pdf-logo/inspect.ts";
import { WIDE_PNG } from "@paperwork/domain/business/pdf-logo/fixtures.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9493;
const BASE = `http://localhost:${PORT}`;

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
async function call(
  method: string,
  path: string,
  body?: unknown,
  sid?: string,
): Promise<Res> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(sid ? { "x-session-id": sid } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch { /* raw */ }
  return { status: r.status, body: parsed };
}

async function login(phone: string, name = "Alexander Jerez"): Promise<string> {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const sid = v.body.sessionId as string;
  await call("PUT", "/me", { name, language: "en" }, sid);
  return sid;
}

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
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

// REQ-550 (demo-fixes): an invoice issued at birth bills someone — a typed
// bill-to name stands in where the test names no customer.
const mk = (sid: string, body: Record<string, unknown>) =>
  call("POST", "/invoices", {
    amount: 10000,
    jobName: "Mow",
    ...(body.customerId ? {} : { billTo: { name: "Rosa Diaz" } }),
    ...body,
  }, sid)
    .then((r) => r.body);

Deno.test("REQ-627 the server enforces the removal rules: draft → delete; sent → 409 must_void then void (kept, who/when/why); paid → 409 locked_paid both ways", async () => {
  await withServer(async () => {
    const sid = await login("+15125557001");
    const draft = await mk(sid, { status: "draft" });
    const sched = await mk(sid, {
      status: "scheduled",
      scheduledFor: "2026-12-01",
    });
    const sent = await mk(sid, { status: "sent" });
    const paid = await mk(sid, {
      status: "paid",
      paidAt: new Date().toISOString(),
    });

    // a never-sent draft: void is refused (nothing to cancel), delete removes it
    const voidDraft = await call("POST", `/invoices/${draft.id}/void`, {}, sid);
    assertEquals([voidDraft.status, voidDraft.body.reason], [
      409,
      "must_delete",
    ]);
    assertEquals(
      (await call("DELETE", `/invoices/${draft.id}`, undefined, sid)).body,
      { ok: true },
    );
    assertEquals(
      (await call("GET", `/invoices/${draft.id}`, undefined, sid)).status,
      404,
    );
    assertEquals(
      (await call("DELETE", `/invoices/${sched.id}`, undefined, sid)).body,
      { ok: true },
    );

    // sent: delete refused, void keeps it as Cancelled with who / when / why
    const delSent = await call(
      "DELETE",
      `/invoices/${sent.id}`,
      undefined,
      sid,
    );
    assertEquals([delSent.status, delSent.body.reason], [409, "must_void"]);
    const v = await call("POST", `/invoices/${sent.id}/void`, {
      reason: "Wrong address",
    }, sid);
    assertEquals(v.status, 200);
    assertEquals(v.body.status, "void");
    assertEquals(v.body.voidReason, "Wrong address");
    assertEquals(v.body.voidedBy.name, "Alexander Jerez");
    assert(v.body.voidedAt);
    const list = (await call("GET", "/invoices", undefined, sid)).body;
    assert(
      list.some((i: { id: string; status: string }) =>
        i.id === sent.id && i.status === "void"
      ),
      "stays in the list",
    );
    // twice is refused; and a void bill is not deleted either
    assertEquals(
      (await call("POST", `/invoices/${sent.id}/void`, {}, sid)).body.reason,
      "already_void",
    );
    assertEquals(
      (await call("DELETE", `/invoices/${sent.id}`, undefined, sid)).body
        .reason,
      "already_void",
    );
    // the customer's link says cancelled, and it cannot be paid
    const pub = await call("GET", `/invoices/${sent.id}/public`);
    assertEquals(pub.body.status, "void");
    const claim = await call("POST", `/invoices/${sent.id}/claim-payment`, {
      method: "zelle",
    });
    assertEquals([claim.status, claim.body.reason], [409, "void"]);

    // paid: neither
    for (
      const r of [
        await call("DELETE", `/invoices/${paid.id}`, undefined, sid),
        await call("POST", `/invoices/${paid.id}/void`, {}, sid),
        await call("POST", `/invoices/${paid.id}/void-duplicate`, {}, sid),
      ]
    ) assertEquals([r.status, r.body.reason], [409, "locked_paid"]);
  });
});

Deno.test("REQ-627 a draft with a payment on it is voided, and its payments stay attached and visible", async () => {
  await withServer(async () => {
    const sid = await login("+15125557002");
    const inv = await mk(sid, { status: "draft" });
    const pay = await call("POST", "/payments", {
      invoiceId: inv.id,
      amount: 2500,
      method: "cash",
      receivedAt: new Date().toISOString(),
    }, sid);
    assert(pay.status < 300, JSON.stringify(pay.body));
    const del = await call("DELETE", `/invoices/${inv.id}`, undefined, sid);
    assertEquals([del.status, del.body.reason], [409, "must_void"]);
    const v = await call("POST", `/invoices/${inv.id}/void`, {}, sid);
    assertEquals(v.body.status, "void");
    const payments =
      (await call("GET", `/payments?invoiceId=${inv.id}`, undefined, sid)).body;
    const mine = (Array.isArray(payments) ? payments : []).filter((
      p: { invoiceId: string },
    ) => p.invoiceId === inv.id);
    assertEquals(mine.length, 1, "the payment is still there");
  });
});

Deno.test("REQ-627 void & duplicate: the sent bill is voided and a fresh draft copy with a NEW number carries the content", async () => {
  await withServer(async () => {
    const sid = await login("+15125557003");
    const customer =
      (await call("POST", "/customers", { name: "Ana Torres" }, sid)).body;
    const sent = await mk(sid, {
      status: "sent",
      customerId: customer.id,
      lineItems: [{
        description: "Mow",
        quantity: 2,
        unit: "visit",
        price: 5000,
      }],
      taxRateBp: 825,
    });
    const r = await call("POST", `/invoices/${sent.id}/void-duplicate`, {
      reason: "typo",
    }, sid);
    assertEquals(r.status, 200);
    assertEquals(r.body.voided.status, "void");
    assertEquals(r.body.voided.replacedBy, r.body.draft.id);
    assertEquals(r.body.draft.status, "draft");
    assertEquals(r.body.draft.replaces, sent.id);
    assertEquals(r.body.draft.customerId, customer.id);
    assertEquals(r.body.draft.amount, 10000);
    assertEquals(r.body.draft.lineItems.length, 1);
    assert(
      r.body.draft.number && r.body.draft.number !== sent.number,
      `${r.body.draft.number} vs ${sent.number}`,
    );
    // the copy is a plain draft — editable, deletable
    assertEquals(
      (await call("DELETE", `/invoices/${r.body.draft.id}`, undefined, sid))
        .body,
      { ok: true },
    );
  });
});

Deno.test("REQ-627 bulk: delete removes the drafts and skips the rest with reasons; void voids the sent ones; other owners' ids are skipped as not_found; >500 is 400", async () => {
  await withServer(async () => {
    const other = await login("+15125557099", "Someone Else");
    const theirs = await mk(other, { status: "draft" });
    const sid = await login("+15125557004");
    const d1 = await mk(sid, { status: "draft" });
    const d2 = await mk(sid, { status: "draft" });
    const s1 = await mk(sid, { status: "sent" });
    const p1 = await mk(sid, {
      status: "paid",
      paidAt: new Date().toISOString(),
    });
    const del = await call("POST", "/invoices/bulk-remove", {
      action: "delete",
      ids: [d1.id, d2.id, s1.id, p1.id, theirs.id],
    }, sid);
    assertEquals(del.status, 200);
    const by = Object.fromEntries(
      del.body.results.map((
        r: { id: string; outcome: string; reason?: string },
      ) => [r.id, `${r.outcome}${r.reason ? ":" + r.reason : ""}`]),
    );
    assertEquals(by, {
      [d1.id]: "deleted",
      [d2.id]: "deleted",
      [s1.id]: "skipped:must_void",
      [p1.id]: "skipped:locked_paid",
      [theirs.id]: "skipped:not_found",
    });
    assertEquals([del.body.done, del.body.skipped], [2, 3]);
    assertEquals(
      (await call("GET", `/invoices/${theirs.id}`, undefined, other)).status,
      200,
      "never touched",
    );
    const vd = await call("POST", "/invoices/bulk-remove", {
      action: "void",
      ids: [s1.id, p1.id],
      reason: "duplicate",
    }, sid);
    assertEquals(vd.body.results.map((r: { outcome: string }) => r.outcome), [
      "voided",
      "skipped",
    ]);
    assertEquals(
      (await call("GET", `/invoices/${s1.id}`, undefined, sid)).body.voidReason,
      "duplicate",
    );
    const tooMany = await call("POST", "/invoices/bulk-remove", {
      action: "delete",
      ids: Array.from({ length: 501 }, (_, i) => `x${i}`),
    }, sid);
    assertEquals([tooMany.status, tooMany.body.reason], [400, "too_many"]);
    const bad = await call("POST", "/invoices/bulk-remove", {
      action: "explode",
      ids: [d1.id],
    }, sid);
    assertEquals(bad.status, 400);
  });
});

Deno.test("REQ-629 POST /invoices/pdf-batch: one PDF, every invoice on its own page(s), their logo embedded once and on every bill, how-to-pay + pay link, no DocuMonster", async () => {
  await withServer(async () => {
    const sid = await login("+15125557005");
    // the business: a logo, a name, Zelle + Venmo
    const up = (await call("POST", "/files", {
      filename: "logo.png",
      mimeType: "image/png",
      base64: btoa(String.fromCharCode(...WIDE_PNG)),
    }, sid)).body;
    assert(up.id, JSON.stringify(up));
    const put = await call("PUT", "/profile/identity", {
      businessName: "A2Z Landscape LLC",
      logoFileId: up.id,
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@a2zlandscape.com" },
        venmo: { enabled: true, handle: "@a2z-landscape" },
      },
    }, sid);
    assert(put.status < 300, JSON.stringify(put.body));
    const customer = (await call("POST", "/customers", {
      name: "Randall Belknap",
      address: "725 Frederick Rd, Myrtle Beach, SC 29577",
    }, sid)).body;
    const a = await mk(sid, { status: "sent", customerId: customer.id });
    const b = await mk(sid, {
      status: "sent",
      customerId: customer.id,
      amount: 4200,
    });
    // a long one: 70 lines spill onto a second page
    const long = await mk(sid, {
      status: "draft",
      customerId: customer.id,
      lineItems: Array.from(
        { length: 70 },
        (_, i) => ({
          description: `Visit ${i + 1}`,
          quantity: 1,
          unit: "visit",
          price: 100,
        }),
      ),
      amount: 7000,
    });
    const res = await fetch(`${BASE}/invoices/pdf-batch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ ids: [a.id, b.id, long.id] }),
    });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/pdf");
    assert(
      /attachment; filename="invoices-\d{4}-\d{2}-\d{2}\.pdf"/.test(
        res.headers.get("content-disposition") ?? "",
      ),
    );
    const f = await pdfFacts(new Uint8Array(await res.arrayBuffer()));
    assert(f.pages >= 4, `3 invoices, the last on 2+ pages: ${f.pages}`);
    assertEquals(f.images, 1, "the logo is embedded once for the whole batch");
    // every invoice's first page paints the logo
    assert(
      f.imagesPerPage.filter((n) => n > 0).length >= 3,
      JSON.stringify(f.imagesPerPage),
    );
    for (const inv of [a, b, long]) {
      assert(f.text.includes(inv.number), inv.number);
    }
    assert(
      f.text.includes("pay@a2zlandscape.com") &&
        f.text.includes("@a2z-landscape"),
      "how to pay",
    );
    assert(f.text.includes(`/i/${a.id}`), "the pay link as text");
    assert(f.text.includes("725 Frederick Rd"), "the mailing address");
    assertEquals(
      /docu\s*monster/i.test(
        `${f.text}${f.title}${f.author}${f.producer}${f.creator}`,
      ),
      false,
    );
  });
});

Deno.test("REQ-629 pdf-batch refuses: no ids / >500 → 400; another owner's id → 404; no session → 401", async () => {
  await withServer(async () => {
    const other = await login("+15125557098", "Someone Else");
    const theirs = await mk(other, { status: "sent" });
    const sid = await login("+15125557006");
    const mine = await mk(sid, { status: "sent" });
    assertEquals(
      (await call("POST", "/invoices/pdf-batch", { ids: [] }, sid)).status,
      400,
    );
    const big = await call("POST", "/invoices/pdf-batch", {
      ids: Array.from({ length: 501 }, (_, i) => `x${i}`),
    }, sid);
    assertEquals([big.status, big.body.reason], [400, "too_many"]);
    const cross = await call("POST", "/invoices/pdf-batch", {
      ids: [mine.id, theirs.id],
    }, sid);
    assertEquals([cross.status, cross.body.reason], [404, "not_found"]);
    assertEquals(
      (await call("POST", "/invoices/pdf-batch", { ids: [mine.id] })).status,
      401,
    );
  });
});

Deno.test("REQ-627 AMENDMENT a bare POST (no body) to void / void-duplicate is 401 without a session, and voids with no reason with one — never a 500", async () => {
  await withServer(async () => {
    for (const p of ["/invoices/x/void", "/invoices/x/void-duplicate"]) {
      assertEquals((await call("POST", p)).status, 401, p);
    }
    const sid = await login("+15125557021");
    const a = await mk(sid, { status: "sent" });
    const va = await call("POST", `/invoices/${a.id}/void`, undefined, sid);
    assertEquals([va.status, va.body.status], [200, "void"]);
    const b = await mk(sid, { status: "sent" });
    const vb = await call("POST", `/invoices/${b.id}/void-duplicate`, undefined, sid);
    assertEquals(vb.status, 200);
  });
});
