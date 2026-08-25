import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9089;

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

Deno.test("public e2e: GET /quotes/:id/public works WITHOUT a session", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const created = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        summary: "Job",
        lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 100 }],
      }),
    }).then((r) => r.json());

    // Hit /public WITHOUT a session — should still resolve.
    const pub = await fetch(
      `http://localhost:${PORT}/quotes/${created.id}/public`,
    ).then((r) => r.json());
    assertEquals(pub.id, created.id);
    assertEquals(pub.summary, "Job");
    assertEquals(pub.lineItems.length, 1);
    assert(!("userId" in pub), "userId must NOT leak to /public");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: POST /quotes/:id/accept (no session) flips status to accepted and bills the milestones", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        summary: "Job",
        lineItems: [],
        status: "sent",
        estimatedTotal: 500_00,
      }),
    }).then((r) => r.json());

    const out = await fetch(`http://localhost:${PORT}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Tom K.",
        signature: "data:image/png;base64,...",
      }),
    }).then((r) => r.json());
    assertEquals(out.ok, true);

    const refetched = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/public`,
    ).then((r) => r.json());
    assertEquals(refetched.status, "accepted");
    assertEquals(refetched.acceptedName, "Tom K.");
    assertEquals(refetched.acceptedSignature, "data:image/png;base64,...");
    assertEquals(typeof refetched.acceptedAt, "string");

    // UX-37 resolved by construction: accepting the quote IS the one
    // ceremony, and it bills — no payment_terms → one full invoice due today.
    const invoices = await fetch(`http://localhost:${PORT}/invoices`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    const milestone = invoices.filter((i: { quoteId?: string }) =>
      i.quoteId === q.id
    );
    assertEquals(milestone.length, 1);
    assertEquals(milestone[0].amount, 500_00);
    assertEquals(milestone[0].status, "sent");
    assertEquals(milestone[0].dueDate, new Date().toISOString().slice(0, 10));
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: POST /quotes/:id/decline flips status to lost and records reason/note", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [], status: "sent" }),
    }).then((r) => r.json());

    const out = await fetch(`http://localhost:${PORT}/quotes/${q.id}/decline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "price",
        note: "Came in higher than I budgeted.",
      }),
    }).then((r) => r.json());
    assertEquals(out.ok, true);

    const refetched = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/public`,
    ).then((r) => r.json());
    assertEquals(refetched.status, "lost");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: POST /quotes/:id/decline cannot revoke an already-accepted quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [], status: "sent" }),
    }).then((r) => r.json());

    await drain(
      await fetch(`http://localhost:${PORT}/quotes/${q.id}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Tom K." }),
      }),
    );

    const declineRes = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/decline`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "price" }),
      },
    );
    assertEquals(declineRes.status, 409);
    await drain(declineRes);

    const refetched = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/public`,
    ).then((r) => r.json());
    assertEquals(refetched.status, "accepted");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: POST /quotes/:id/inquiry returns 200 and does NOT change quote status", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [], status: "sent" }),
    }).then((r) => r.json());

    const out = await fetch(`http://localhost:${PORT}/quotes/${q.id}/inquiry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "Can we start next week instead?",
        contactBack: "555-1234",
      }),
    }).then((r) => r.json());
    assertEquals(out.ok, true);

    // The inquiry itself must not decide the quote (no accepted/lost flip).
    // The public GET used to refetch DOES record an open and flips
    // sent → viewed (roadmap p.13 view tracking), so "viewed" is the
    // expected post-refetch status — not a decision.
    const refetched = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/public`,
    ).then((r) => r.json());
    assertEquals(refetched.status, "viewed");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: GET /quotes/:id/public serves the FULL agreement — terms, dates, customer contact card", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Tom & Linda K.",
        email: "tom@example.com",
        phoneNumber: "+15125550000",
      }),
    }).then((r) => r.json());
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        summary: "Job",
        lineItems: [],
        status: "sent",
        estimatedTotal: 5_000_00,
        terms: [{
          stepId: "payment_terms",
          label: "Payment terms",
          value: "50 / 50",
        }],
        effectiveDate: "2026-05-01",
        startDate: "2026-05-08",
        estimatedCompletionDate: "2026-05-22",
      }),
    }).then((r) => r.json());

    const pub = await fetch(`http://localhost:${PORT}/quotes/${q.id}/public`)
      .then((r) => r.json());
    assertEquals(pub.id, q.id);
    // The quote IS the agreement: /q carries the wizard-captured terms + dates.
    assertEquals(pub.terms, [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "50 / 50",
    }]);
    assertEquals(pub.effectiveDate, "2026-05-01");
    assertEquals(pub.startDate, "2026-05-08");
    assertEquals(pub.estimatedCompletionDate, "2026-05-22");
    // Full customer projection for the To/Para contact card (P-13).
    assertEquals(pub.customer.name, "Tom & Linda K.");
    assertEquals(pub.customer.email, "tom@example.com");
    assertEquals(pub.customer.phoneNumber, "+15125550000");
    assert(!("userId" in pub), "userId must NOT leak to /public");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: accept with a TIN stores it masked to the last 4 and never leaks it publicly", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [], status: "sent" }),
    }).then((r) => r.json());

    const out = await fetch(`http://localhost:${PORT}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signature: "sig",
        name: "Tom K.",
        tin: "123-45-6789",
      }),
    }).then((r) => r.json());
    assertEquals(out.ok, true);

    // Owner view: the TIN lands masked to the last 4 — never the raw value.
    const owned = await fetch(`http://localhost:${PORT}/quotes/${q.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(owned.acceptedTinMasked, "***-**-6789");
    assertEquals(owned.status, "accepted");

    // Public view: even the masked TIN is omitted.
    const pub = await fetch(`http://localhost:${PORT}/quotes/${q.id}/public`)
      .then((r) => r.json());
    assert(
      !("acceptedTinMasked" in pub),
      "masked TIN must not appear on /public",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: a second accept is a 409 already_accepted, not a silent success (P-11)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [], status: "sent" }),
    }).then((r) => r.json());

    await drain(
      await fetch(`http://localhost:${PORT}/quotes/${q.id}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Tom K." }),
      }),
    );

    const second = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Someone Else" }),
      },
    );
    assertEquals(second.status, 409);
    const body = await second.json();
    assertEquals(body.reason, "already_accepted");

    // The original acceptor is never overwritten.
    const refetched = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/public`,
    ).then((r) => r.json());
    assertEquals(refetched.acceptedName, "Tom K.");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: accept on a declined (lost) quote is a 409 declined", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [], status: "sent" }),
    }).then((r) => r.json());

    await drain(
      await fetch(`http://localhost:${PORT}/quotes/${q.id}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "price" }),
      }),
    );

    const res = await fetch(`http://localhost:${PORT}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tom K." }),
    });
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.reason, "declined");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: GET /invoices/:id/public works WITHOUT a session, redacts userId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const i = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ dueDate: "2026-05-01", amount: 1_000 }),
    }).then((r) => r.json());

    const pub = await fetch(`http://localhost:${PORT}/invoices/${i.id}/public`)
      .then((r) => r.json());
    assertEquals(pub.id, i.id);
    assertEquals(pub.amount, 1_000);
    assert(!("userId" in pub), "userId must NOT leak to /public");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: POST /invoices/:id/claim-payment flips status to claimed and records intent", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    // Seed: quote → invoice (status=sent) — invoices key on quoteId now.
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [] }),
    }).then((r) => r.json());
    const inv = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        quoteId: quote.id,
        dueDate: "2026-06-01",
        amount: 100_00,
        status: "sent",
      }),
    }).then((r) => r.json());

    // Customer (no session) claims a check payment.
    const claim = await fetch(
      `http://localhost:${PORT}/invoices/${inv.id}/claim-payment`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "check",
          reference: "#1234",
          claimedBy: "Hans",
        }),
      },
    ).then((r) => r.json());
    assertEquals(claim.ok, true);

    const pub = await fetch(
      `http://localhost:${PORT}/invoices/${inv.id}/public`,
    ).then((r) => r.json());
    assertEquals(pub.status, "claimed");
    assertEquals(pub.paymentIntent?.method, "check");
    assertEquals(pub.paymentIntent?.reference, "#1234");
    assertEquals(pub.paymentIntent?.claimedBy, "Hans");
    assertEquals(pub.paymentIntent?.amount, 100_00);
    assert(!("userId" in pub), "userId must NOT leak to /public");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: claim-payment rejects unknown methods", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "x", lineItems: [] }),
    }).then((r) => r.json());
    const inv = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        quoteId: quote.id,
        dueDate: "2026-06-01",
        amount: 100,
        status: "sent",
      }),
    }).then((r) => r.json());

    const res = await fetch(
      `http://localhost:${PORT}/invoices/${inv.id}/claim-payment`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "bitcoin" }),
      },
    );
    // Bad method short-circuits with a 5xx (parseClaim throws).
    assert(!res.ok);
    await res.body?.cancel();
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: claim-payment is 409 when invoice already paid", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "x", lineItems: [] }),
    }).then((r) => r.json());
    const inv = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        quoteId: quote.id,
        dueDate: "2026-06-01",
        amount: 100,
        status: "paid",
      }),
    }).then((r) => r.json());

    const res = await fetch(
      `http://localhost:${PORT}/invoices/${inv.id}/claim-payment`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "check" }),
      },
    );
    assertEquals(res.status, 409);
    await res.body?.cancel();
  } finally {
    await server.stop();
    await resetKv();
  }
});
