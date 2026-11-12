/**
 * REQ-582 — demo-loop cycle 4, issue m39: the composer shows an onboarding
 * placeholder ("Your first name", "name@yourbusiness.com — or 'skip'",
 * "Venmo @handle …") only while an onboarding ask is open.
 *
 * An ask is open when the latest assistant message IS one of the onboarding
 * ask templates (EN or ES) — the same template identity the server's
 * `classifyLastAsk` (backend onboarding/mod.ts) uses to route the user's
 * next reply into the onboarding branch. A reply that merely mentions
 * "email" or "payment" mid-thread is not an ask, so it gets the REQ-450
 * trade/flow example.
 */
export type OnboardingPlaceholderKey =
  | "asstChat.composer.firstName"
  | "asstChat.composer.businessName"
  | "asstChat.composer.stateCode"
  | "asstChat.composer.address"
  | "asstChat.composer.email";

/** Onboarding ask template key → the placeholder shown while it is open. */
const ASK_PLACEHOLDER: ReadonlyArray<[string, OnboardingPlaceholderKey]> = [
  ["onboarding.askName", "asstChat.composer.firstName"],
  ["onboarding.askNameAndBusiness", "asstChat.composer.firstName"],
  ["onboardingChat.name.reprompt", "asstChat.composer.firstName"],
  ["onboarding.askBusiness", "asstChat.composer.businessName"],
  ["onboardingChat.business.reprompt", "asstChat.composer.businessName"],
  ["onboarding.askState", "asstChat.composer.stateCode"],
  ["onboarding.askStateGuess", "asstChat.composer.stateCode"],
  ["onboardingChat.state.reprompt", "asstChat.composer.stateCode"],
  ["onboarding.askAddress", "asstChat.composer.address"],
  ["onboardingChat.address.reprompt", "asstChat.composer.address"],
  // The combined email + payout ask: the email is what the line asks first.
  ["onboarding.askPayout", "asstChat.composer.email"],
];

const LANGS = ["en", "es"] as const;
type AskLang = typeof LANGS[number];

/** Raw template lookup (placeholders left as `{name}`). */
export type TemplateLookup = (lang: AskLang, key: string) => string;

interface ChatMsgLike {
  role: string;
  kind?: string;
  content?: string;
}

/** The placeholder of the onboarding ask the latest assistant message is,
 *  or null when no onboarding ask is open. */
export function openOnboardingAsk(
  msgs: ReadonlyArray<ChatMsgLike>,
  template: TemplateLookup,
): OnboardingPlaceholderKey | null {
  // The latest assistant TEXT message — exactly the one the server's
  // classifyLastAsk reads to decide whether the reply answers an ask.
  let last: ChatMsgLike | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" && msgs[i].kind === "text") {
      last = msgs[i];
      break;
    }
  }
  const c = (last?.content ?? "").trim();
  if (!c) return null;
  for (const [askKey, placeholder] of ASK_PLACEHOLDER) {
    for (const lang of LANGS) {
      const raw = template(lang, askKey);
      // The ask's leading literal (before its first `{placeholder}`), as the
      // server's classifyLastAsk reads it. A missing key echoes the key.
      if (!raw || raw === askKey) continue;
      const prefix = raw.split("{")[0].trim();
      if (prefix.length > 0 && c.startsWith(prefix)) return placeholder;
    }
  }
  return null;
}
