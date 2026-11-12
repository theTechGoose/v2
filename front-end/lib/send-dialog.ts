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

/**
 * REQ-402 (demo-loop cycle 2, m5): the channel the send starts on — the
 * recommended one, or Text + Email when nothing is on file (the dialog then
 * asks for both). The island's smart default and the menu's/dialog's
 * "Recommended" tag are this one rule, never two copies.
 */
export function defaultSendChannel(
  customer: ContactOnFile | undefined,
): SendChannel {
  return recommendedChannel(customer) ?? "both";
}

/**
 * REQ-402 (m5): the hint a channel option carries when the customer can't
 * be reached on it with what is on file — "needs an email" / "needs a
 * phone" / "needs a phone and email"; undefined when the channel is ready.
 */
export function channelNeedsKey(
  channel: SendChannel,
  customer: ContactOnFile | undefined,
): string | undefined {
  const needsEmail = channel !== "sms" && !has(customer?.email);
  const needsPhone = channel !== "email" && !has(customer?.phoneNumber);
  if (needsEmail && needsPhone) return "asstChat.send.needsBoth";
  if (needsEmail) return "asstChat.send.needsEmail";
  if (needsPhone) return "asstChat.send.needsPhone";
  return undefined;
}

/**
 * REQ-402 (m5): the label of the dialog's add-contact field. When the
 * contact is the chosen channel's only way to reach the customer it is
 * plainly "Customer's email" / "Customer's phone"; with Text + Email it
 * keeps "Add an email to also email it".
 */
export function addFieldLabelKey(
  field: "email" | "phone",
  channel: SendChannel,
): string {
  if (field === "email") {
    return channel === "email"
      ? "asstChat.send.customerEmail"
      : "asstChat.send.addEmail";
  }
  return channel === "sms"
    ? "asstChat.send.customerPhone"
    : "asstChat.send.addPhone";
}
