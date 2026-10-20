/**
 * REQ-090 — "the backend takes that booking and keeps the consent on record": the demo card on the
 * v3 /landing2 posts to POST /demo-request — a call with just a cell (as soon as possible) or a demo
 * with a day and a window — and a booking is three things at once: the team's inbox gets it with
 * the consent on record, the person gets the text the page promised ("Te confirmamos por texto"),
 * and the phone is a CRM lead (REQ-060/072, carried by the outbox). A booking without the ticked
 * box is refused and nothing is sent. This drives the controller with capturing collaborators in
 * every seat — the int lane runs in one process, so nothing here touches the env.
 */
import "#reflect-metadata";
import { assertEquals, assertMatch } from "#std/assert";
import type { ExecutionContext } from "#danet/core";
import { DemoRequestController } from "./mod.ts";
import type {
  EmailService,
  SendEmailInput,
  SendEmailResult,
} from "@communication/domain/data/email-service/mod.ts";
import type {
  SendSmsInput,
  SendSmsResult,
  SmsService,
} from "@users/domain/data/sms/mod.ts";
import type { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import type { RateLimiter } from "@core/data/rate-limit/mod.ts";
import { upcomingDemoDays } from "#demo-booking/mod.ts";

class CapturingInbox {
  sent: SendEmailInput[] = [];
  send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return Promise.resolve({ ok: true, messageId: `m-${this.sent.length}` });
  }
}
class CapturingPhone {
  sent: SendSmsInput[] = [];
  send(input: SendSmsInput): Promise<SendSmsResult> {
    this.sent.push(input);
    return Promise.resolve({ ok: true, sid: `SM${this.sent.length}` });
  }
}
class CapturingLeads {
  phones: string[] = [];
  enqueue(phone: string): Promise<void> {
    this.phones.push(phone);
    return Promise.resolve();
  }
}
const openGate = {
  take: () => Promise.resolve({ allowed: true, remaining: 4, resetMs: 0 }),
} as unknown as RateLimiter;
const closedGate = {
  take: () => Promise.resolve({ allowed: false, remaining: 0, resetMs: 1234 }),
} as unknown as RateLimiter;
/** ctx.json(body) is the one thing the controller uses of the context */
function context() {
  return { ctx: { json: (v: unknown) => v } as unknown as ExecutionContext };
}

const tomorrow = () =>
  new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10);
const demo = () => ({
  mode: "demo",
  name: "José García",
  phone: "(512) 555-0199",
  email: "jose@tunegocio.com",
  day: tomorrow(),
  slot: "morning",
  lang: "es",
  consent: true,
});
const call = () => ({
  mode: "call",
  name: "",
  phone: "(512) 555-0199",
  email: "",
  day: "",
  slot: "",
  lang: "en",
  consent: true,
});

function build(gate = openGate) {
  const inbox = new CapturingInbox();
  const phone = new CapturingPhone();
  const leads = new CapturingLeads();
  const controller = new DemoRequestController(
    inbox as unknown as EmailService,
    phone as unknown as SmsService,
    leads as unknown as CrmLeadCapture,
    gate,
  );
  return { inbox, phone, leads, controller };
}
type Reply = Record<string, unknown>;

Deno.test("REQ-090 demo-request int — a demo with a day and a window and a call with just a cell are both bookings; the team's email records the consent; a booking without it is refused and nothing is sent", async () => {
  // the demo: emailed, texted in Spanish, a lead; the reply says what was done
  {
    const { inbox, phone, leads, controller } = build();
    const res = await controller.submit(
      context().ctx,
      demo(),
    ) as unknown as Reply;
    assertEquals(res.ok, true);
    assertEquals(res.emailed, true);
    assertEquals(res.texted, true);
    assertEquals(res.lead, true);
    assertEquals(res.mode, "demo");
    assertEquals(res.day, tomorrow());
    assertEquals(res.slot, "morning");
    assertEquals(inbox.sent.length, 1);
    assertMatch(
      inbox.sent[0].subject,
      /^\[demo\] José García — \d{4}-\d{2}-\d{2} morning$/,
    );
    assertMatch(inbox.sent[0].htmlBody ?? "", /\+15125550199/);
    assertMatch(inbox.sent[0].htmlBody ?? "", /jose@tunegocio\.com/);
    assertMatch(inbox.sent[0].htmlBody ?? "", /Morning, 9 AM – 12 PM Eastern/);
    assertMatch(inbox.sent[0].htmlBody ?? "", /Consent:<\/strong> yes/);
    assertEquals(phone.sent.length, 1);
    assertEquals(phone.sent[0].to, "+15125550199");
    assertMatch(phone.sent[0].body, /Demo de 15 min/);
    assertMatch(phone.sent[0].body, /Mañana, 9 AM – 12 PM \(hora del Este\)/);
    assertEquals(leads.phones, ["+15125550199"]);
  }
  // the call: just a cell, as soon as possible, texted in English when the page was English
  {
    const { inbox, phone, leads, controller } = build();
    const res = await controller.submit(
      context().ctx,
      call(),
    ) as unknown as Reply;
    assertEquals(res.ok, true);
    assertEquals(res.mode, "call");
    assertEquals(res.day, "");
    assertEquals(res.slot, "");
    assertEquals(inbox.sent.length, 1);
    assertMatch(
      inbox.sent[0].subject,
      /^\[call\] \+15125550199 — as soon as possible$/,
    );
    assertMatch(inbox.sent[0].htmlBody ?? "", /Consent:<\/strong> yes/);
    assertMatch(phone.sent[0].body, /Phone call · as soon as possible/);
    assertEquals(leads.phones, ["+15125550199"]);
  }
  // no consent: refused by name, nothing sent — for a demo and for a call
  for (
    const body of [{ ...demo(), consent: false }, {
      ...call(),
      consent: undefined,
    }]
  ) {
    const { inbox, phone, leads, controller } = build();
    const res = await controller.submit(
      context().ctx,
      body,
    ) as unknown as Reply;
    assertEquals(res.ok, false);
    assertEquals(res.reason, "invalid");
    assertEquals(res.field, "consent");
    assertEquals(
      inbox.sent.length + phone.sent.length + leads.phones.length,
      0,
    );
  }
});

Deno.test("REQ-090 demo-request int — a malformed booking is refused by field, in the ok:false envelope the public forms use, and nothing is sent", async () => {
  const { inbox, phone, leads, controller } = build();
  const res = await controller.submit(context().ctx, {
    ...demo(),
    slot: "11:00 AM",
  }) as unknown as Reply;
  assertEquals(res.ok, false);
  assertEquals(res.reason, "invalid");
  assertEquals(res.field, "slot");
  assertEquals(inbox.sent.length + phone.sent.length + leads.phones.length, 0);
});

Deno.test("REQ-081 demo-request int — a flooded phone is told to wait and nothing is sent", async () => {
  const { inbox, phone, leads, controller } = build(closedGate);
  const res = await controller.submit(
    context().ctx,
    demo(),
  ) as unknown as Reply;
  assertEquals(res.ok, false);
  assertEquals(res.reason, "too_many_attempts");
  assertEquals(res.retryAfterMs, 1234);
  assertEquals(inbox.sent.length + phone.sent.length + leads.phones.length, 0);
});

Deno.test("REQ-081 demo-request int — the team still has the booking when the text cannot go out; the reply says the text did not", async () => {
  const { inbox, phone, leads, controller } = build();
  phone.send = (input: SendSmsInput) => {
    phone.sent.push(input);
    return Promise.resolve({
      ok: false,
      reason: "sms.invalidNumber",
      code: 21211,
    });
  };
  const res = await controller.submit(
    context().ctx,
    demo(),
  ) as unknown as Reply;
  assertEquals(res.ok, true);
  assertEquals(res.emailed, true);
  assertEquals(res.texted, false);
  assertEquals(inbox.sent.length, 1);
  assertEquals(leads.phones.length, 1);
});

/** REQ-102 — the picker slides past its first five days: a day on any page the picker shows is a booking */
Deno.test("REQ-102 demo-request int — a demo on a day beyond the first five — the sixth, and the last day the page offers — is a booking: emailed, texted and a lead, the reply and the team's subject naming that day", async () => {
  const offered = upcomingDemoDays("es");
  for (const day of [offered[5]?.iso, offered[offered.length - 1]?.iso]) {
    const { inbox, phone, leads, controller } = build();
    const res = await controller.submit(context().ctx, {
      ...demo(),
      day,
    }) as unknown as Reply;
    assertEquals(res.ok, true, `${day}: ${JSON.stringify(res)}`);
    assertEquals(res.day, day);
    assertEquals(res.slot, "morning");
    assertEquals(inbox.sent.length, 1);
    assertMatch(inbox.sent[0].subject, new RegExp(`— ${day} morning$`));
    assertEquals(phone.sent.length, 1);
    assertEquals(leads.phones, ["+15125550199"]);
  }
});
