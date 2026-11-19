/**
 * REQ-967 — LOOP-007 cycle 1, issue q1-44: the countersigned agreement PDF
 * (GET /quotes/:id/pdf after the customer signs on /q) titled the
 * customer's box "YOUR SIGNATURE" above "Linda Park", while /q says
 * "LINDA PARK'S SIGNATURE" (REQ-692). Signed through the real accept
 * endpoint, the PDF must carry the signer's name in the box title.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone = "+15125557967"): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

/** Every string pdf-lib drew (Flate-compressed hex-string Tj operators). */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
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
  return out;
}

Deno.test('REQ-967 (LOOP-007 q1-44): signed through POST /quotes/:id/accept, GET /quotes/:id/pdf titles the customer box "LINDA PARK\'S SIGNATURE", not "YOUR SIGNATURE"', async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const q = await new QuoteStore().create(owner.userId, {
      summary: "Kitchen remodel",
      lineItems: [{
        description: "Remodel",
        quantity: 1,
        unit: "job",
        price: 120_000,
      }],
      estimatedTotal: 120_000,
      terms: [],
    } as never);
    await new QuoteStore().update(q.id, owner.userId, { status: "sent" });

    // unsigned: the REQ-032 prompt
    const before = await fetch(`${base()}/quotes/${q.id}/pdf`);
    assertEquals(before.status, 200);
    assertStringIncludes(
      await drawnText(new Uint8Array(await before.arrayBuffer())),
      "YOUR SIGNATURE",
    );

    const acc = await fetch(`${base()}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Linda Park" }),
    });
    assertEquals(acc.status, 200, await acc.text());

    const res = await fetch(`${base()}/quotes/${q.id}/pdf`);
    assertEquals(res.status, 200);
    const text = await drawnText(new Uint8Array(await res.arrayBuffer()));
    assertStringIncludes(text, "Linda Park", "the signer's name is drawn");
    assertStringIncludes(text, "LINDA PARK'S SIGNATURE");
    assert(!text.includes("YOUR SIGNATURE"), text);
  } finally {
    await server.stop();
    await resetKv();
  }
});
