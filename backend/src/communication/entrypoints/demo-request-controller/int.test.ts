/**
 * REQ-090/108 — "the backend takes that booking and keeps the consent on record": the demo card on
 * /landing2 posts to POST /demo-request — a demo on a specific day and time, with the name, the
 * cell and the email (REQ-108: the call with just a cell is gone) — and a booking is three things
 * at once: the team's inbox gets it with the date, the time and the consent on record, the person
 * gets the text the page promised ("Te confirmamos por texto"), and the phone is a CRM lead
 * (REQ-060/072, carried by the outbox). A booking without the ticked box is refused and nothing is
 * sent. This drives the controller with capturing collaborators in every seat — the int lane runs
 * in one process, so nothing here touches the env.
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
  name: "José García",
  phone: "(512) 555-0199",
  email: "jose@tunegocio.com",
  day: tomorrow(),
  time: "10:30",
  lang: "es",
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

Deno.test("REQ-108 demo-request int — a demo on a day and a time is a booking: the team's email carries the date, the time and the consent; the person is texted in their language; the phone is a lead; a booking without the ticked box is refused and nothing is sent", async () => {
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
    assertEquals(res.day, tomorrow());
    assertEquals(res.time, "10:30");
    assertEquals(inbox.sent.length, 1);
    assertMatch(
      inbox.sent[0].subject,
      /^\[demo\] José García — \d{4}-\d{2}-\d{2} 10:30 AM Eastern$/,
    );
    assertMatch(inbox.sent[0].htmlBody ?? "", /\+15125550199/);
    assertMatch(inbox.sent[0].htmlBody ?? "", /jose@tunegocio\.com/);
    assertMatch(inbox.sent[0].htmlBody ?? "", /10:30 AM Eastern/);
    assertMatch(inbox.sent[0].htmlBody ?? "", /Consent:<\/strong> yes/);
    assertEquals(phone.sent.length, 1);
    assertEquals(phone.sent[0].to, "+15125550199");
    assertMatch(phone.sent[0].body, /Demo de 15 min/);
    assertMatch(phone.sent[0].body, /10:30 AM \(hora del Este\)/);
    assertEquals(leads.phones, ["+15125550199"]);
  }
  // no consent: refused by name, nothing sent
  for (
    const body of [{ ...demo(), consent: false }, {
      ...demo(),
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
    time: "11:00 AM",
  }) as unknown as Reply;
  assertEquals(res.ok, false);
  assertEquals(res.reason, "invalid");
  assertEquals(res.field, "time");
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
    assertEquals(res.time, "10:30");
    assertEquals(inbox.sent.length, 1);
    assertMatch(inbox.sent[0].subject, new RegExp(`— ${day} 10:30 AM Eastern$`));
    assertEquals(phone.sent.length, 1);
    assertEquals(leads.phones, ["+15125550199"]);
  }
});

// REQ-117 — "call me should be there": the call with just a cell is a booking again, beside the
// day-and-time demo (REQ-108).
const call = () => ({ mode: "call", name: "", phone: "(512) 555-0199", email: "", day: "", time: "", lang: "en", consent: true });

Deno.test("REQ-117 demo-request int — Call me is back: a call with just a cell is a booking as soon as possible — the team's email says [call] and as soon as possible with the consent on record, the person is texted in English, the phone is a lead, and the reply says mode call with no day and no time; a demo still answers mode demo with its day and time", async () => {
  const { inbox, phone, leads, controller } = build();
  const res = await controller.submit(context().ctx, call()) as unknown as Reply;
  assertEquals([res.ok, res.mode, res.day, res.time, res.emailed, res.texted, res.lead], [true, "call", "", "", true, true, true]);
  assertEquals(inbox.sent.length, 1);
  assertMatch(inbox.sent[0].subject, /^\[call\] \+15125550199 — as soon as possible$/);
  assertMatch(inbox.sent[0].htmlBody ?? "", /When:<\/strong> as soon as possible/);
  assertMatch(inbox.sent[0].htmlBody ?? "", /Consent:<\/strong> yes/);
  assertEquals(phone.sent.length, 1);
  assertEquals(phone.sent[0].to, "+15125550199");
  assertMatch(phone.sent[0].body, /Phone call · as soon as possible/);
  assertEquals(leads.phones, ["+15125550199"]);
  const d = await build().controller.submit(context().ctx, demo()) as unknown as Reply;
  assertEquals([d.ok, d.mode, d.day, d.time], [true, "demo", tomorrow(), "10:30"]);
});

// REQ-149 — /landing5's "Need help? We can call you" card: a call as soon as possible WITH a name
// (the mock collects name and cell). The parse already takes a name on a call; this pins what the
// team and the person get when it is there.
Deno.test("REQ-149 demo-request int — a call with a name: the team's subject and email name the person, the text greets them by name, the phone is a lead, and the reply says mode call", async () => {
  const { inbox, phone, leads, controller } = build();
  const res = await controller.submit(context().ctx, { ...call(), name: "Ana López", lang: "es" }) as unknown as Reply;
  assertEquals([res.ok, res.mode, res.day, res.time, res.emailed, res.texted, res.lead], [true, "call", "", "", true, true, true]);
  assertEquals(inbox.sent.length, 1);
  assertMatch(inbox.sent[0].subject, /^\[call\] Ana López — as soon as possible$/);
  assertMatch(inbox.sent[0].htmlBody ?? "", /Name:<\/strong> Ana López/);
  assertEquals(phone.sent.length, 1);
  assertMatch(phone.sent[0].body, /Ana López/);
  assertEquals(leads.phones, ["+15125550199"]);
});

// REQ-211 — Raphael, 2026-11-06: "There is something that says what landing page it is coming
// from?" — the booking's page and ad reach the team's email and ride the lead to the CRM.
Deno.test("REQ-211 demo-request int — the page and the ad are in the team's email and go with the lead", async () => {
  class OriginLeads {
    calls: unknown[][] = [];
    enqueue(...args: unknown[]): Promise<void> {
      this.calls.push(args);
      return Promise.resolve();
    }
  }
  const inbox = new CapturingInbox();
  const leads = new OriginLeads();
  const controller = new DemoRequestController(
    inbox as unknown as EmailService,
    new CapturingPhone() as unknown as SmsService,
    leads as unknown as CrmLeadCapture,
    openGate,
  );
  const res = await controller.submit(context().ctx, { mode: "call", phone: "(512) 555-0211", consent: true, lang: "es", page: "/landing5", ad: "sabado" }) as unknown as Reply;
  assertEquals(res.ok, true);
  assertMatch(inbox.sent[0].htmlBody ?? "", /from \/landing5\?ad=sabado<\/h2>/);
  assertMatch(inbox.sent[0].htmlBody ?? "", /Page:<\/strong> \/landing5\?ad=sabado/);
  assertEquals(leads.calls, [["+15125550211", { page: "/landing5", ad: "sabado" }]], "the lead carries its origin");
  // without them: as before — the lead by phone, no origin
  const bare = await controller.submit(context().ctx, { mode: "call", phone: "(512) 555-0212", consent: true }) as unknown as Reply;
  assertEquals(bare.ok, true);
  assertEquals(leads.calls[1], ["+15125550212", undefined]);
});
