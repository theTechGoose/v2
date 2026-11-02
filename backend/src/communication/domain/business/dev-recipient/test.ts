// REQ-126 — Raphael, 2026-11-02: "the tests send emails to hans and andy, it should not send
// emails to anyone but me on tests." Off the real deploy every email is addressed to Raphael,
// the originals named in the subject. Pure rule, no I/O.
import { assertEquals } from "#std/assert";
import { deliveredTo, DEV_RECIPIENT, isRealDeploy } from "./mod.ts";

const payload = {
  From: "DocuMonster <hello@documonster.com>",
  To: "hp@hans.work, rafac@monsterrg.com, amcgill@monsterrg.com",
  Cc: "ops@acme.test",
  Subject: "Demo booking — Ana Roofing",
  HtmlBody: "<p>hi</p>",
  MessageStream: "outbound" as const,
};

Deno.test("REQ-126 dev-recipient — off the deploy the To is Raphael alone, the Cc is gone, and the subject names who it was for", () => {
  const out = deliveredTo(payload, {});
  assertEquals(DEV_RECIPIENT, "rafac@monsterrg.com");
  assertEquals(out.To, DEV_RECIPIENT);
  assertEquals("Cc" in out, false, "nobody is copied");
  assertEquals(
    out.Subject,
    "[to: hp@hans.work, rafac@monsterrg.com, amcgill@monsterrg.com; cc: ops@acme.test] Demo booking — Ana Roofing",
  );
  assertEquals(out.HtmlBody, payload.HtmlBody, "the body is untouched");
  assertEquals(out.From, payload.From, "the From is untouched (REQ-123)");
  const { Cc: _cc, ...noCc } = payload;
  assertEquals(
    deliveredTo(noCc, {}).Subject,
    "[to: hp@hans.work, rafac@monsterrg.com, amcgill@monsterrg.com] Demo booking — Ana Roofing",
    "no cc, no cc note",
  );
});

Deno.test("REQ-126 dev-recipient — DEV_MAIL_TO moves the one address, never the rule", () => {
  const out = deliveredTo(payload, { DEV_MAIL_TO: " raphael@example.test " });
  assertEquals(out.To, "raphael@example.test");
  assertEquals("Cc" in out, false);
  assertEquals(
    deliveredTo(payload, { DEV_MAIL_TO: "   " }).To,
    DEV_RECIPIENT,
    "a blank override is no override",
  );
});

Deno.test("REQ-126 dev-recipient — on the real deploy the request is exactly what the caller asked", () => {
  const out = deliveredTo(payload, {
    DENO_DEPLOYMENT_ID: "abc123",
    DEV_MAIL_TO: "nobody@example.test",
  });
  assertEquals(out, payload);
});

Deno.test("REQ-126 dev-recipient — a blank DENO_DEPLOYMENT_ID is not the deploy", () => {
  assertEquals(isRealDeploy({}), false);
  assertEquals(isRealDeploy({ DENO_DEPLOYMENT_ID: "  " }), false);
  assertEquals(isRealDeploy({ DENO_DEPLOYMENT_ID: "x" }), true);
});
