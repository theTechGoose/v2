/**
 * REQ-403 (demo-loop cycle 2, issue m11): the ONE guarded dispatch every
 * customer text goes through — the quote/invoice send and the post-signing
 * completion text alike. A missing, invalid or fictional number never reaches
 * the provider (the dev fake answers ok for any number, which is how the demo
 * logged "Texted to +15125550177"), so a caller that logs a comms-trail row
 * on `ok` only ever logs a real delivery.
 */
import { isFictionalUsNumber } from "@users/domain/business/normalize-phone/mod.ts";
import type { SmsService } from "@users/domain/data/sms/mod.ts";
import { t } from "@core/i18n/mod.ts";
import {
  type SmsFailureCode,
  smsFailureCodeForReasonKey,
} from "#quote-flow/sms-failure.ts";
import type { QuoteDelivery } from "#quote-flow/delivery.ts";

/** Normalize a raw phone to E.164 (US-default); undefined when it can't be. */
export function normalizeE164(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

export type CustomerSmsTarget =
  | { ok: true; e164: string }
  | { ok: false; failureCode: "missing" }
  | { ok: false; failureCode: "invalid" }
  | { ok: false; failureCode: "fictional"; e164: string };

/** Can this customer number take a text at all? */
export function customerSmsTarget(
  raw: string | undefined | null,
): CustomerSmsTarget {
  if (!raw?.trim()) return { ok: false, failureCode: "missing" };
  const e164 = normalizeE164(raw);
  if (!e164) return { ok: false, failureCode: "invalid" };
  if (isFictionalUsNumber(e164)) {
    return { ok: false, failureCode: "fictional", e164 };
  }
  return { ok: true, e164 };
}

export interface CustomerSmsResult {
  ok: boolean;
  /** The E.164 number dialled (or the raw input when it could not be). */
  to: string;
  sid?: string;
  /** The contractor-facing reason (UI language) on failure. */
  reason?: string;
  /** REQ-030: the provider's raw text, for logs. */
  detail?: string;
  /** REQ-226: why the text didn't go out, as a code. */
  failureCode?: SmsFailureCode;
}

/** Guard, then dispatch. `ok` means the provider accepted the message. */
export async function dispatchCustomerSms(
  sms: SmsService,
  input: { to: string; body: string; uiLang: "en" | "es" },
): Promise<CustomerSmsResult> {
  const target = customerSmsTarget(input.to);
  if (!target.ok) {
    if (target.failureCode === "missing") {
      return {
        ok: false,
        reason:
          "no recipient: pass `to` or attach a customer with a phone number",
        to: "",
        failureCode: "missing",
      };
    }
    if (target.failureCode === "invalid") {
      return {
        ok: false,
        reason: `invalid phone: ${input.to}`,
        to: input.to,
        failureCode: "invalid",
      };
    }
    // A fictional 555 number never reaches Twilio (it would answer 21211);
    // say so in words instead of a raw provider error. REQ-226: the provider
    // and its code stay in `detail` (logs), never in the contractor's copy.
    return {
      ok: false,
      reason: t(input.uiLang, "sms.fictionalNumber"),
      detail: `fictional number: ${target.e164} (Twilio would answer 21211)`,
      to: target.e164,
      failureCode: "fictional",
    };
  }
  const sent = await sms.send({ to: target.e164, body: input.body });
  if (sent.ok) return { ...sent, to: target.e164 };
  // A recognised Twilio rejection arrives as a lang key — translate it.
  return {
    ...sent,
    to: target.e164,
    reason: sent.reason && /^sms\./.test(sent.reason)
      ? t(input.uiLang, sent.reason)
      : sent.reason,
    failureCode: smsFailureCodeForReasonKey(sent.reason),
  };
}

/** True when the latest send attempt tried to text and reached nobody by text. */
function latestTextFailed(d: QuoteDelivery | null | undefined): boolean {
  return !!d && !!d.smsFailureReason && !d.textedTo;
}

/**
 * Which confirmation the signed public page may promise: an email when the
 * customer has one; a text only when the number can take one AND the latest
 * text to it did not fail; otherwise none (the page says the contractor has
 * the signed copy and offers the PDF).
 */
export function signedConfirmChannel(
  customer: { email?: string | null; phoneNumber?: string | null } | undefined,
  lastDelivery?: QuoteDelivery | null,
): "email" | "text" | "none" {
  if (customer?.email?.trim()) return "email";
  if (!customerSmsTarget(customer?.phoneNumber).ok) return "none";
  return latestTextFailed(lastDelivery) ? "none" : "text";
}
