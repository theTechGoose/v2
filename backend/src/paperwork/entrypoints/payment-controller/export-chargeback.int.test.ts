/**
 * REQ-1129 (LOOP-007 cycle 3, q3-57) — AMENDMENT of REQ-019 / REQ-926.
 * Raphael (LOOP-007): "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green".
 *
 * QA: a $400.25 check recorded on an unpaid invoice, then charged back with
 * a $35 fee, appeared in neither export. GET /payments/export.csv reads
 * PaymentStore.listByUser, which since REQ-926 drops `reversedAt` payments,
 * while the /payments page (listByUserAll) shows them in "Charged back".
 * The payments CSV must carry every payment the page lists, the charged-back
 * one marked as such.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9571;
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

async function login(phone: string): Promise<string> {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const sid = v.body.sessionId as string;
  await call("PUT", "/me", { name: "Export Owner", language: "en" }, sid);
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

/** split one CSV line on commas outside quotes */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function monthRange(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

Deno.test("REQ-1129 (LOOP-007 q3, q3-57) GET /payments/export.csv for this month lists the charged-back $400.25 check next to the paid Zelle, and marks it charged back in a Status column", async () => {
  await withServer(async () => {
    const sid = await login("+15125571129");
    const mk = async (job: string, cents: number) =>
      (await call("POST", "/invoices", {
        status: "sent",
        jobName: job,
        billTo: { name: "Rosa Diaz" },
        lineItems: [{ description: job, quantity: 1, unit: "job", price: cents }],
        subtotalCents: cents,
        amount: cents,
      }, sid)).body;
    const inv1 = await mk("Deck rebuild", 254442);
    const inv2 = await mk("Fence repair", 120000);
    assert(inv1.id && inv2.id, JSON.stringify([inv1, inv2]));
    const now = new Date().toISOString();
    const zelle = (await call("POST", "/payments", {
      invoiceId: inv1.id,
      amount: 254442,
      method: "zelle",
      receivedAt: now,
    }, sid)).body;
    assert(zelle.id, JSON.stringify(zelle));
    // a part payment by check on INV-002, then it bounces with a $35 fee
    const check = (await call("POST", "/payments", {
      invoiceId: inv2.id,
      amount: 40025,
      method: "check",
      receivedAt: now,
      reference: "CHK 1042",
    }, sid)).body;
    assert(check.id, JSON.stringify(check));
    const cb = await call("POST", `/payments/${check.id}/chargeback`, {
      feeCents: 3500,
      reason: "Check bounced",
    }, sid);
    assertEquals(cb.status, 200, JSON.stringify(cb.body));

    // the /payments page lists both (REQ-926: the whole list carries it)
    const listed = (await call("GET", "/payments", undefined, sid)).body;
    assertEquals(listed.length, 2, "the page lists both payments");

    const { from, to } = monthRange();
    const r = await fetch(
      `${BASE}/payments/export.csv?from=${from}&to=${to}`,
      { headers: { "x-session-id": sid } },
    );
    assertEquals(r.status, 200);
    const lines = (await r.text()).trim().split(/\r?\n/);
    const header = cells(lines[0]);
    const rows = lines.slice(1).map(cells);
    assertEquals(
      rows.length,
      2,
      `the export carries every payment the page lists (Zelle + the charged-back check); got:\n${lines.join("\n")}`,
    );
    const checkRow = rows.find((c) => c.includes("400.25"));
    assert(
      checkRow,
      `the $400.25 check is in the payments CSV; got:\n${lines.join("\n")}`,
    );
    const statusAt = header.findIndex((h) => /^status$/i.test(h.trim()));
    assert(
      statusAt >= 0,
      `the payments CSV has a Status column; header: ${lines[0]}`,
    );
    assert(
      /charged back/i.test(checkRow[statusAt] ?? ""),
      `the check row says charged back; got ${JSON.stringify(checkRow)}`,
    );
    const zelleRow = rows.find((c) => c.includes("2544.42"))!;
    assert(zelleRow, "the Zelle row stays");
    assert(
      !/charged back/i.test(zelleRow[statusAt] ?? ""),
      `the Zelle row is not charged back; got ${JSON.stringify(zelleRow)}`,
    );
  });
});
