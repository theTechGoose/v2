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
