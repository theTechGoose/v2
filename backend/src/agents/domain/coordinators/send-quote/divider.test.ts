/**
 * REQ-593 — demo-loop cycle 4, issue m12: the send / resend divider read
 * "…por mensaje de texto a +15128675309" — `textedTo` is the E.164 the SMS
 * service normalizes to, interpolated as is. The divider's label shows the
 * number the way the rest of the app does (formatPhoneDisplay); the payload's
 * `textedTo` stays the raw recipient.
 */
import { assertEquals } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { renderChatI18n } from "#quote-flow/chat-i18n.ts";
import { buildDivider as buildRef } from "./mod.ts";

/** REQ-589 made the divider a key + vars; its label is that ref rendered. */
function buildDivider(
  o: Parameters<typeof buildRef>[0] & {
    lang: "en" | "es";
    emailFailureReason?: string;
  },
): string {
  const { lang, emailFailureReason, ...rest } = o;
  return renderChatI18n(
    buildRef({
      ...rest,
      ...(emailFailureReason ? { emailFailure: emailFailureReason } : {}),
    }),
    lang,
    (l, k, v) => t(l, k, v),
  );
}

Deno.test("REQ-593 m12 divider: 'Guardar y reenviar' by email + text names the number as +1 (512) 867-5309", () => {
  assertEquals(
    buildDivider({
      channel: "both",
      emailedTo: "bob@example.com",
      textedTo: "+15128675309",
      lang: "es",
    }),
    "Cotización + Acuerdo enviada por correo a bob@example.com y por mensaje de texto a +1 (512) 867-5309",
  );
});

Deno.test("REQ-593 m12 divider: text only and text-with-email-failed format the number too", () => {
  assertEquals(
    buildDivider({ channel: "sms", textedTo: "+15128675309", lang: "en" }),
    "Quote + Agreement texted to +1 (512) 867-5309",
  );
  assertEquals(
    buildDivider({
      channel: "both",
      textedTo: "+15128675309",
      emailFailureReason: "bounced",
      lang: "en",
    }),
    "Quote + Agreement texted to +1 (512) 867-5309 — email failed (bounced)",
  );
});

// REQ-764 (demo-loop cycle 5v2, m12): a text skipped because the number can't
// take texts reads "not texted: <reason>", never "text failed (…)".
Deno.test("REQ-764 m12 divider: email + skipped text says 'not texted: <reason>' in en and es", () => {
  for (const lang of ["en", "es"] as const) {
    const label = renderChatI18n(
      buildRef({
        channel: "both",
        emailedTo: "maria@example.com",
        smsFailure: { key: "sms.fictionalNumber" },
        smsSkipped: true,
      }),
      lang,
      (l, k, v) => t(l, k, v),
    );
    assertEquals(
      label,
      t(lang, "sendQuote.divider.emailedNotTexted", {
        emailedTo: "maria@example.com",
        reason: t(lang, "sms.fictionalNumber"),
      }),
    );
    assertEquals(
      label.includes(t(lang, "sms.fictionalNumber")),
      true,
      `the reason is in the line: ${label}`,
    );
  }
});
