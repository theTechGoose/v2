/**
 * REQ-944 (LOOP-007 cycle 1, q1-10) — documents sent in the evening carried
 * the next day's date. An Austin, TX business (Central) sent its quote at
 * 7:37 PM on Nov 18; the agreement page, its signature date and the PDF read
 * Nov 19 because every date path used UTC, never the business's time zone.
 *
 * Integration over HTTP, app booted, in-memory KV: a TX business's quote
 * created and published at 2026-11-19T05:37Z (11:37 PM Central on Nov 18,
 * Nov 19 in UTC and in New York). The public /q payload carries the zone the
 * page must render in, and the agreement PDF prints Nov 18.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule, AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
// 11:37 PM Central on Wed Nov 18; Thu Nov 19 in UTC and in New York
const LATE_EVENING = "2026-11-19T05:37:00.000Z";

async function login(phone: string): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

/** Every string pdf-lib drew (hex-string / literal Tj operators). */
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
  return out.replace(/\s*\n\s*/g, " ");
}

/** a TX business with a quote sent late in its evening */
async function texasQuoteSentLate(): Promise<string> {
  const sid = await login("+15125552944");
  const auth = { "content-type": "application/json", "x-session-id": sid };
  const put = async (path: string, body: unknown) =>
    await (await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(body),
    })).body?.cancel();
  await put("/me", { name: "Rosa Garza", language: "en" });
  await put("/profile/identity", {
    businessName: "Garza Roofing",
    commsLanguage: "en",
  });
  await put("/profile/address", {
    street: "100 Congress Ave",
    city: "Austin",
    state: "TX",
  });
  const me = await fetch(`${BASE}/me`, { headers: auth }).then((r) => r.json());
  const userId: string = me.id ?? me.user?.id;
  assert(userId, `GET /me has an id: ${JSON.stringify(me)}`);
  const made = await new QuoteStore().create(userId, {
    summary: "Roof repair",
    lineItems: [{ description: "Shingles", quantity: 1, price: 1_200_00 }],
    estimatedTotal: 1_200_00,
  });
  // the instants the server stamped at creation and send, pinned to the evening
  const kv = await getKv();
  const row = (await kv.get<Record<string, unknown>>(["quote", made.id]))
    .value!;
  await kv.set(["quote", made.id], {
    ...row,
    status: "sent",
    createdAt: LATE_EVENING,
    publishedAt: LATE_EVENING,
    sentAt: LATE_EVENING,
  });
  return made.id;
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

Deno.test("REQ-944 q1-10: the public quote payload carries the business's time zone (a TX business → America/Chicago) for the /q page's dates", async () => {
  await withServer(async () => {
    const id = await texasQuoteSentLate();
    const pub = await fetch(`${BASE}/quotes/${id}/public`).then((r) =>
      r.json()
    );
    assertEquals(pub.contractor?.state, "TX");
    assertEquals(
      pub.timezone ?? pub.contractor?.timezone,
      "America/Chicago",
      "the /q payload names the zone its dates are printed in",
    );
  });
});

Deno.test("REQ-944 q1-10: the agreement PDF of a quote sent at 11:37 PM Central on Nov 18 is dated November 18, not the UTC day", async () => {
  await withServer(async () => {
    const id = await texasQuoteSentLate();
    const res = await fetch(`${BASE}/quotes/${id}/pdf`);
    assertEquals(res.status, 200);
    const text = await drawnText(new Uint8Array(await res.arrayBuffer()));
    // the contractor's signature date is the day it was sent (effectiveDate ?? createdAt)
    const signed = text.match(
      /By: Rosa Garza Date: ([A-Z][a-z]+ \d{1,2}, \d{4})/,
    )?.[1];
    assertEquals(
      signed,
      "November 18, 2026",
      "the contractor's signature date",
    );
  });
});
