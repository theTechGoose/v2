import "#reflect-metadata";
import { assert, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-783 (demo-loop cycle dv1, issue d4) on the booted app. Raphael: "Yes,
 * default terms." Run the terms wizard accepting its picks; the customer's
 * agreement PDF states the default "7 days' notice". Then the owner changes
 * the cancellation row in the quote review — the island PUTs the quote's
 * terms with the picked option, as pickTermOption does — and the customer's
 * agreement (GET /quotes/:id/public + /pdf) carries the edit, never the
 * 7-day default beside it.
 */
@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9783;
const BASE = `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

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

async function login(phone = "+15125557830"): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function call(method: string, path: string, body: unknown, sid: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...J, "x-session-id": sid },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  assert(res.ok, `${path} answered ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

/** Every string pdf-lib drew (hex-string / literal Tj operators). */
async function pdfText(quoteId: string): Promise<string> {
  const res = await fetch(`${BASE}/quotes/${quoteId}/pdf`);
  assert(res.ok, `pdf answered ${res.status}`);
  const doc = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let s: string;
    try {
      s = new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
    } catch {
      continue;
    }
    for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      let line = "";
      for (let i = 0; i + 1 < m[1].length; i += 2) {
        line += String.fromCharCode(parseInt(m[1].slice(i, i + 2), 16));
      }
      out += line + "\n";
    }
    for (const m of s.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      out += m[1] + "\n";
    }
  }
  return out.replace(/\s*\n\s*/g, " ");
}

Deno.test("REQ-783 d4 (cycle dv1) e2e: the wizard's agreement keeps the 7-day default; the review's 14-day edit is what the customer's agreement says", async () => {
  await withServer(async () => {
    const sid = await login();
    const conv = await call("POST", "/agents/conversations", {}, sid);
    const convId = conv.id ?? conv.conversation?.id;
    const quote = await call("POST", "/quotes", {
      summary: "Bathroom floor",
      jobName: "Bathroom floor",
      lineItems: [{
        description: "Install porcelain tile 12x24",
        quantity: 1,
        unit: "ea",
        price: 240_000,
      }],
      estimatedTotal: 240_000,
    }, sid);
    await call(
      "POST",
      `/agents/conversations/${convId}/draft`,
      { quoteId: quote.id },
      sid,
    );
    await call(
      "POST",
      `/agents/conversations/${convId}/transition-to-terms?docKind=quote`,
      {},
      sid,
    );
    await call("POST", "/agents/wizard/answer", {
      conversationId: convId,
      stepId: "customer",
      optionId: "create_new",
      customer: { create: { name: "Ana Diaz" } },
    }, sid);
    for (
      const [stepId, optionId] of [
        ["start_date", "asap"],
        ["wraps", "1_week"],
        ["payment_terms", "50_50"],
        ["warranty", "12_months"],
      ]
    ) {
      await call("POST", "/agents/wizard/answer", {
        conversationId: convId,
        stepId,
        optionId,
      }, sid);
    }

    const before = await pdfText(quote.id);
    assertStringIncludes(before, "CANCELLATION");
    assertStringIncludes(before, "7 days' notice");

    // The review's cancellation row → "14 days' notice" (pickTermOption).
    const q = await fetch(`${BASE}/quotes/${quote.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    const terms = [
      ...(q.terms ?? []).filter((t: { stepId: string }) =>
        t.stepId !== "cancellation"
      ),
      {
        stepId: "cancellation",
        label: "Cancellation",
        value: "14 days' notice",
      },
    ];
    await call("PUT", `/quotes/${quote.id}`, { terms }, sid);

    const pub = await fetch(`${BASE}/quotes/${quote.id}/public`).then((r) =>
      r.json()
    );
    const row = (pub.terms ?? []).find((t: { stepId: string }) =>
      t.stepId === "cancellation"
    );
    assert(row?.value === "14 days' notice", JSON.stringify(pub.terms));

    const after = await pdfText(quote.id);
    assertStringIncludes(after, "14 days' notice");
    assertStringIncludes(after, "14 days' written notice");
    assert(!after.includes("7 days"), `the 7-day default is gone: ${after}`);
  });
});
