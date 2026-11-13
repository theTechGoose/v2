/**
 * REQ-308 (demo-loop cycle 1, M3): the send dialog's two derivations.
 *
 * The dialog offers Text + Email / Text / Email. Which one is "Recommended"
 * and which contact an attempt still lacks both follow what the customer
 * actually has on file (plus what was just typed) — never a hard-wired
 * "both", never a generic "add a phone or email" when only one is missing.
 *
 * REQ-399 (demo-loop cycle 2, M16 + M17): the Send itself — one in flight at
 * a time (`runExclusive`), a typed contact checked for format before it is
 * saved (`sendDialogErrorKey`), and a refused save shown as dictionary copy,
 * never lib/api's "PUT /customers/<id> failed: 400" (`contactSaveErrorKey`).
 */
import {
  customerContactError,
  isValidCustomerEmail,
  isValidCustomerPhone,
} from "../../shared/quote-flow/customer-contact.ts";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import { phoneCantReceiveTexts } from "../../shared/quote-flow/sms-number.ts";
import {
  asCommsLang,
  type CommsLang,
} from "../../shared/quote-flow/comms-language.ts";

export type SendChannel = "both" | "sms" | "email";

export interface ContactOnFile {
  email?: string | null;
  phoneNumber?: string | null;
}

const has = (v: string | null | undefined): boolean =>
  !!v && v.trim().length > 0;

/** REQ-569 (cycle 4, m46): a phone on file that can't take a text. */
const cantText = (customer: ContactOnFile | undefined): boolean =>
  phoneCantReceiveTexts(customer?.phoneNumber);

/**
 * The channel to tag "Recommended": both only when the customer has an email
 * AND a phone, else the one channel they have, nothing when they have neither.
 * REQ-569 (demo m46): a phone that can't receive texts (the shared fictional
 * rule the SMS guard refuses) does not count — email alone is recommended.
 */
export function recommendedChannel(
  customer: ContactOnFile | undefined,
): SendChannel | undefined {
  const email = has(customer?.email);
  const phone = has(customer?.phoneNumber) && !cantText(customer);
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
 * REQ-399 (demo M17): the dialog's whole pre-flight — the missing contact
 * (REQ-308) first, then the format of what was typed (the backend's own
 * REQ-278 rule), so "bob at gmail" never reaches PUT /customers. Undefined
 * when the send can go.
 */
export function sendDialogErrorKey(
  channel: SendChannel,
  customer: ContactOnFile | undefined,
  typed: { email: string; phone: string },
): string | undefined {
  const missing = missingContactKey(channel, customer, typed);
  if (missing) return missing;
  return customerContactError({
    email: typed.email,
    phoneNumber: typed.phone,
  }) ?? undefined;
}

/** REQ-399 (demo M17): the copy for a contact save the backend refused. */
export function contactSaveErrorKey(err: unknown): string {
  const body = (err as { body?: unknown } | null)?.body;
  const key = body && typeof body === "object"
    ? (body as { message?: unknown }).message
    : undefined;
  if (key === "customer.invalidEmail" || key === "customer.invalidPhone") {
    return key;
  }
  return "asstChat.send.contactSaveFailed";
}

/**
 * REQ-603 (demo M23): the chat recovery box's per-field check, run before its
 * save. A letter in the phone is flagged (never silently stripped); a phone
 * that is not a full number, or a malformed email, gets the REQ-278 key. A
 * blank field is not a format error.
 */
export interface RecoveryContactErrors {
  phone?: "asstChat.recovery.phoneLetters" | "customer.invalidPhone";
  email?: "customer.invalidEmail";
}

export function recoveryContactErrors(
  draft: { email?: string | null; phone?: string | null },
): RecoveryContactErrors {
  const out: RecoveryContactErrors = {};
  const phone = (draft.phone ?? "").trim();
  const email = (draft.email ?? "").trim();
  if (phone) {
    if (/\p{L}/u.test(phone)) out.phone = "asstChat.recovery.phoneLetters";
    else if (!isValidCustomerPhone(phone)) out.phone = "customer.invalidPhone";
  }
  if (email && !isValidCustomerEmail(email)) {
    out.email = "customer.invalidEmail";
  }
  return out;
}

/**
 * REQ-603 (demo M23): the recovery phone box's value — the as-you-type mask,
 * except when a letter was typed: then the raw text, so the letter the check
 * flags is still on screen.
 */
export function recoveryPhoneValue(raw: string): string {
  return /\p{L}/u.test(raw ?? "") ? raw : formatPhoneInput(raw ?? "");
}

/** REQ-399 (demo M16): one Send click's id — the server drops a repeat. */
export function newSendRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * REQ-399 (demo M16): run `fn` only when nothing else holds `flag` — a
 * synchronous check-and-set, so a double-click's second click, landing before
 * any re-render, sees the first one in flight and does nothing. A ref from
 * useRef(false) is the flag; it is released when `fn` settles, thrown or not.
 */
export async function runExclusive<T>(
  flag: { current: boolean },
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (flag.current) return undefined;
  flag.current = true;
  try {
    return await fn();
  } finally {
    flag.current = false;
  }
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
  // REQ-569 (m46): a phone that can't take texts never starts the send on
  // Text — Email, which asks for an address when none is on file.
  if (cantText(customer)) return "email";
  return recommendedChannel(customer) ?? "both";
}

/**
 * REQ-402 (m5): the hint a channel option carries when the customer can't
 * be reached on it with what is on file — "needs an email" / "needs a
 * phone" / "needs a phone and email" — or, REQ-569, "This number can't
 * receive texts" for Text when the phone on file is fictional; undefined
 * when the channel is ready.
 */
export function channelNeedsKey(
  channel: SendChannel,
  customer: ContactOnFile | undefined,
): string | undefined {
  // REQ-569 (m46): the phone on file is certain to refuse a text.
  if (channel !== "email" && cantText(customer)) {
    return "asstChat.send.cantText";
  }
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

/**
 * REQ-459 (demo-loop cycle 3, m44): the main send button's label once the
 * user picked a channel in the ▾ menu — "Send by email…" / "Send by text…" /
 * "Send by text + email…". Before any pick the island keeps REQ-402's
 * neutral "Send…".
 */
export function sendOpenLabelKey(channel: SendChannel): string {
  if (channel === "email") return "asstChat.preview.sendOpenEmail";
  if (channel === "sms") return "asstChat.preview.sendOpenSms";
  return "asstChat.preview.sendOpenBoth";
}

/**
 * REQ-715 (demo-loop cycle 5, m31 + c4-M34): the language "Sends in" starts
 * on — the customer's own language (Customer.language, "Carmen reads
 * Spanish") when one is on file, else the app language. The contractor can
 * still pick the other one for this send.
 */
export function defaultSendLang(
  customer: { language?: string | null } | null | undefined,
  appLang: string,
): CommsLang {
  return asCommsLang(customer?.language) ?? (appLang === "es" ? "es" : "en");
}

/**
 * REQ-715: the languages "Sends in" offers — the app language first, then the
 * contractor's send languages (Settings; English when none), then the
 * customer's own language when it is not among them, so the language the
 * dialog starts on is always one of its choices. en | es only, no repeats.
 */
export function sendLangChoices(
  appLang: string,
  sendLanguages: readonly string[] | null | undefined,
  customerLang?: string | null,
): CommsLang[] {
  const out: CommsLang[] = [];
  const add = (v: string | null | undefined) => {
    const l = asCommsLang(v);
    if (l && !out.includes(l)) out.push(l);
  };
  add(appLang);
  for (const l of sendLanguages?.length ? sendLanguages : ["en"]) add(l);
  add(customerLang);
  return out;
}
