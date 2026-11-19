/**
 * REQ-944 (LOOP-007 cycle 1, q1-13) — the batch-sent invoice email showed a
 * blank "Issued —" and a due date 29 days after its "Drafted" date.
 *
 * FieldBatches.send emails the draft BEFORE it stamps issuedDate (and
 * asDelivered never fills it), so the Issued row renders "—"; the header
 * "Drafted" formats `new Date()` in the server's zone (UTC) while the due
 * date counts from the business's day (fieldToday), so an evening send reads
 * one day short.
 *
 * Integration over HTTP, FieldModule booted, in-memory KV; only the email
 * provider is captured. The business runs on a zone whose calendar day is not
 * UTC's right now (Pago Pago before 10:00 UTC, Kiritimati after), set the
 * same on FIELD_TZ and on the business identity, so the UTC fault is red at
 * any hour on any host.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { fmtPaperworkDate } from "#quote-flow/email-format.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

/** a real zone whose calendar day differs from UTC's at this moment */
function zoneOffUtcDay(now = new Date()): string {
  return now.getUTCHours() < 10 ? "Pacific/Pago_Pago" : "Pacific/Kiritimati";
}

/** the text of the cell/div right after the one labelled `label` */
function valueAfter(html: string, label: string): string | undefined {
  return html.match(
    new RegExp(
      `>${label}</(?:div|td)>\\s*<(?:div|td)[^>]*>([^<]*)<`,
    ),
  )?.[1]?.trim();
}

Deno.test("REQ-944 q1-13: a batch-sent invoice email shows its issue date, and Drafted / Issued / Due agree with the business's day (due = issued + days to pay)", async () => {
  const zone = zoneOffUtcDay();
  const prevTz = Deno.env.get("FIELD_TZ");
  Deno.env.set("FIELD_TZ", zone);
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  const emails: SendEmailInput[] = [];
  const realSend = EmailService.prototype.send;
  EmailService.prototype.send = function (input: SendEmailInput) {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: HeadersInit = {},
    // deno-lint-ignore no-explicit-any
  ): Promise<{ status: number; body: any }> => {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch { /* raw */ }
    return { status: r.status, body: parsed };
  };
  try {
    const phone = "+15125559440";
    await call("POST", "/auth/send-otp", { phoneNumber: phone });
    const stored = await new OtpStore().get(phone);
    const v = await call("POST", "/auth/verify-otp", {
      phoneNumber: phone,
      code: stored!.code,
    });
    const H = { "x-session-id": v.body.sessionId as string };
    await call("PUT", "/me", { name: "Field Owner", language: "en" }, H);
    const ident = await call("PUT", "/profile/identity", {
      businessName: "A2Z Landscape LLC",
      commsLanguage: "en",
      timezone: zone,
    }, H);
    assertEquals(ident.status, 200, JSON.stringify(ident.body));

    const customer = (await call("POST", "/customers", {
      name: "Ana Torres",
      email: "ana@blackhole.postmarkapp.com",
    }, H)).body;
    const worker = (await call("POST", "/field/workers", {
      name: "Luis",
      phoneNumber: "843-555-0201",
      pin: "1234",
    }, H)).body;
    const today = fieldToday();
    const sub = (await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Lawn", priceCents: 6500 }],
    }, H)).body;
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: worker.id,
    }, H);
    await call("POST", "/field/tasks/generate", { date: today }, H);
    const tasks =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H)).body;
    assertEquals(tasks.length, 1, JSON.stringify(tasks));
    await call("PUT", `/field/tasks/${tasks[0].id}`, { status: "complete" }, H);

    const pulled = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals(pulled.status, 201, JSON.stringify(pulled.body));
    const draft = pulled.body.invoices[0];
    const sent = await call("POST", `/field/batches/${pulled.body.id}/send`, {
      invoiceIds: [draft.id],
    }, H);
    assertEquals(sent.body.sent, 1, JSON.stringify(sent.body));

    const after = (await call("GET", `/invoices/${draft.id}`, undefined, H))
      .body;
    assertEquals(
      after.issuedDate,
      today,
      "the invoice is issued on the business's day",
    );
    const netDays: number = after.netDays;
    assertEquals(emails.length, 1);
    const html = emails[0].htmlBody;
    const dates = {
      // REQ-980 (q1-61): the header date is labelled "Issued", not "Drafted"
      drafted: valueAfter(html, "Drafted"),
      issued: valueAfter(html, "Issued"),
      due: valueAfter(html, "Due"),
    };
    assertEquals(dates, {
      drafted: undefined,
      issued: fmtPaperworkDate(today, "en"),
      due: fmtPaperworkDate(shiftDate(today, netDays), "en"),
    }, `zone ${zone}, business day ${today}, ${netDays} days to pay`);
  } finally {
    await server.stop();
    await resetKv();
    EmailService.prototype.send = realSend;
    if (prevTz === undefined) Deno.env.delete("FIELD_TZ");
    else Deno.env.set("FIELD_TZ", prevTz);
  }
});
