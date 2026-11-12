/**
 * REQ-308 (demo-loop cycle 1, M3): the send dialog's two derivations.
 *
 * The dialog offers Text + Email / Text / Email. Which one is "Recommended"
 * and which contact an attempt still lacks both follow what the customer
 * actually has on file (plus what was just typed) — never a hard-wired
 * "both", never a generic "add a phone or email" when only one is missing.
 */

export type SendChannel = "both" | "sms" | "email";

export interface ContactOnFile {
  email?: string | null;
  phoneNumber?: string | null;
}

const has = (v: string | null | undefined): boolean =>
  !!v && v.trim().length > 0;

/**
 * The channel to tag "Recommended": both only when the customer has an email
 * AND a phone, else the one channel they have, nothing when they have neither.
 */
export function recommendedChannel(
  customer: ContactOnFile | undefined,
): SendChannel | undefined {
  const email = has(customer?.email);
  const phone = has(customer?.phoneNumber);
  if (email && phone) return "both";
  if (phone) return "sms";
  if (email) return "email";
  return undefined;
}

/**
 * The dictionary key of the error to show when the chosen channel still
 * can't reach the customer after what's on file and what was typed inline —
 * `needEmail` / `needPhone` for the one that is missing, `needContact` when
 * both are; undefined when the send can go.
 */
export function missingContactKey(
  channel: SendChannel,
  customer: ContactOnFile | undefined,
  typed: { email: string; phone: string },
): string | undefined {
  const needsEmail = channel !== "sms" && !has(customer?.email) &&
    !has(typed.email);
  const needsPhone = channel !== "email" && !has(customer?.phoneNumber) &&
    !has(typed.phone);
  if (needsEmail && needsPhone) return "asstChat.customerStep.needContact";
  if (needsEmail) return "asstChat.customerStep.needEmail";
  if (needsPhone) return "asstChat.customerStep.needPhone";
  return undefined;
}
