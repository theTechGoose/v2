/**
 * REQ-226 — why a text didn't go out, as a code the UI can branch on.
 *
 * The send path used to hand back only a translated sentence, and the
 * assistant guessed the recovery from it with `/Invalid|21211/` — which the
 * fictional-number copy happened to match, so a contractor who HAD entered a
 * phone was told "Add their phone to deliver" (demo issues
 * quote-invoice-money-m4, test-setup-claims-555-copy,
 * customers-payments-fieldops-m1).
 */

/** - missing:   no phone to text (none passed, none on the customer)
 *  - invalid:   the number isn't a valid phone number (ours or the provider's verdict)
 *  - fictional: a number in the reserved 555 fiction block
 *  - notMobile: a landline or other line that can't take texts
 *  - optedOut:  the recipient has opted out of texts
 *  - other:     anything else (provider down, refused send, …) */
export type SmsFailureCode =
  | "missing"
  | "invalid"
  | "fictional"
  | "notMobile"
  | "optedOut"
  | "other";

/** The SMS adapter reports a recognised provider rejection as a lang key
 *  (sms.invalidNumber / sms.notMobile / sms.optedOut); map it to a code. */
export function smsFailureCodeForReasonKey(
  key: string | undefined,
): SmsFailureCode {
  switch (key) {
    case "sms.invalidNumber":
      return "invalid";
    case "sms.notMobile":
      return "notMobile";
    case "sms.optedOut":
      return "optedOut";
    default:
      return "other";
  }
}

/** What the phone half of the recovery card asks for:
 *  - "add":   there is no phone on file — ask for one
 *  - "check": the phone on file can't take texts — ask to correct it
 *  - null:    no phone recovery (delivered, no SMS failure, or a failure a
 *             different number would not fix) */
export type SmsRecoveryAsk = "add" | "check" | null;

const NUMBER_PROBLEMS: ReadonlySet<SmsFailureCode> = new Set([
  "invalid",
  "fictional",
  "notMobile",
]);

export function smsRecoveryAsk(
  divider: {
    textedTo?: string;
    smsFailureReason?: string;
    smsFailureCode?: SmsFailureCode | string;
  },
  customerPhone: string | undefined | null,
): SmsRecoveryAsk {
  if (divider.textedTo || !divider.smsFailureReason) return null;
  if (!customerPhone?.trim()) return "add";
  // A divider stored before the code existed carries only translated copy,
  // which is never parsed: with a phone on file it asks for nothing (its
  // label already says why the text failed) — never "add their phone".
  const code = divider.smsFailureCode;
  return code && NUMBER_PROBLEMS.has(code as SmsFailureCode) ? "check" : null;
}
