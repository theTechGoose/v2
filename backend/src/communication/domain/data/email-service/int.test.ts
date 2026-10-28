// REQ-123 — "i do not want to SEND ANYTHING VIA monsterrg.com can we send everything via
// documonster instead?" — the login code's email, driven through the REAL EmailService to a
// captured Postmark request: the From is the house address, whatever the process env says.
// (Postmark's key is shared process state: set for the capture, restored after.)
import { assertEquals } from "#std/assert";
import { EmailService } from "./mod.ts";
import { HOUSE_FROM } from "@communication/domain/business/sender/mod.ts";
import { SendEmailOtp } from "@users/domain/coordinators/send-email-otp/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("REQ-123 EmailService int — the login code's email reaches Postmark from DocuMonster <hello@documonster.com>, not from the POSTMARK_FROM in the process env", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const before = { from: Deno.env.get("POSTMARK_FROM") };
  Deno.env.set("POSTMARK_FROM", "warnings@monsterrg.com"); // what every box's env carries
  try {
    const bodies: Record<string, unknown>[] = [];
    const svc = new EmailService();
    // the token on the service itself, never process env: the int lane runs files in parallel and
    // several of them delete POSTMARK_API_KEY, which sent this test down the dev-mode path (no dispatch,
    // 0 bodies) whenever the delete landed between the set and the send (the gate's find, 2026-10-28)
    svc.apiKeyOverride = "capture-key";
    svc.fetchOverride = ((_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        new Response(JSON.stringify({ MessageID: "pm-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const flow = new SendEmailOtp(new UserStore(), new OtpStore());
    flow.email = svc;
    const result = await flow.run({
      email: "art@documonster.com",
      language: "en",
    });
    assertEquals(result.sent, true);

    assertEquals(bodies.length, 1);
    assertEquals(bodies[0].From, HOUSE_FROM);
    assertEquals(bodies[0].To, "art@documonster.com");
  } finally {
    if (before.from === undefined) Deno.env.delete("POSTMARK_FROM");
    else Deno.env.set("POSTMARK_FROM", before.from);
    await resetKv();
  }
});
