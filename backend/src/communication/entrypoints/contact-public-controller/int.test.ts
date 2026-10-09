/**
 * REQ-068 — Hans's contact-page example: the inquiry form carries a phone and
 * an SMS consent box. The consent has to be on record with the inquiry, so the
 * email the team receives prints both. This drives the controller with a
 * capturing inbox in the EmailService seat and reads the email it dispatches.
 *
 * Why not a stand-in Postmark behind POSTMARK_API_KEY: the int lane runs its
 * files in parallel in ONE process, and three coordinator tests delete that
 * key at their start — the gate caught the race once (0 emails captured).
 * Handing the controller its collaborators directly is deterministic and
 * touches nothing another test can see.
 */
import "#reflect-metadata";
import { assertEquals, assertMatch, assertNotMatch } from "#std/assert";
import type { ExecutionContext } from "#danet/core";
import { ContactPublicController } from "./mod.ts";
import type {
  EmailService,
  SendEmailInput,
  SendEmailResult,
} from "@communication/domain/data/email-service/mod.ts";
import type { RateLimiter } from "@core/data/rate-limit/mod.ts";

/** The team's inbox, as far as this test is concerned. */
class CapturingInbox {
  sent: SendEmailInput[] = [];
  send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return Promise.resolve({ ok: true, messageId: `m-${this.sent.length}` });
  }
}

/** A limiter that lets every inquiry through (the 5-an-hour rule is the e2e test's). */
const openGate = {
  take: () => Promise.resolve({ allowed: true, remaining: 4, resetMs: 0 }),
} as unknown as RateLimiter;

/** The one piece of the request context the controller uses: ctx.json(body). */
const ctx = { json: (v: unknown) => v } as unknown as ExecutionContext;

Deno.test("REQ-068 contact int — the inquiry email carries the phone and the SMS consent, and a form without them still sends", async () => {
  const inbox = new CapturingInbox();
  const controller = new ContactPublicController(
    inbox as unknown as EmailService,
    openGate,
  );
  const post = (body: Record<string, unknown>) =>
    controller.submit(ctx, body) as Promise<{ ok: boolean; reason?: string }>;

  // a consented inquiry: the phone and "yes" are in the email
  const consented = await post({
    name: "Hans Pedersen",
    email: "consent@example.test",
    phone: "540-333-1334",
    subject: "Texting",
    message: "Please text me about the quote.",
    smsConsent: true,
  });
  assertEquals(consented.ok, true);
  assertEquals(inbox.sent.length, 1);
  assertEquals(inbox.sent[0].subject, "[contact] Texting");
  assertMatch(inbox.sent[0].htmlBody, /Phone:<\/strong> 540-333-1334/);
  assertMatch(inbox.sent[0].htmlBody, /SMS consent:<\/strong> yes/);

  // a phone given without ticking the box: on record as "no"
  const declined = await post({
    name: "No Texts",
    email: "declined@example.test",
    phone: "+1 (540) 555-0100",
    subject: "Email only",
    message: "Do not text me.",
    smsConsent: false,
  });
  assertEquals(declined.ok, true);
  assertEquals(inbox.sent.length, 2);
  assertMatch(inbox.sent[1].htmlBody, /Phone:<\/strong> \+1 \(540\) 555-0100/);
  assertMatch(inbox.sent[1].htmlBody, /SMS consent:<\/strong> no/);

  // the form as it was — neither field — still goes through, and says so
  const plain = await post({
    name: "Lead",
    email: "lead@example.test",
    subject: "Need a quote",
    message: "Roof replacement.",
  });
  assertEquals(plain.ok, true);
  assertEquals(inbox.sent.length, 3);
  assertNotMatch(inbox.sent[2].htmlBody, /Phone:/);
  assertMatch(inbox.sent[2].htmlBody, /SMS consent:<\/strong> no/);
});
