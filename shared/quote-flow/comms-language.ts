/**
 * Outbound comms language (UX-28) — THE one resolution for every outbound
 * channel and doc type. The signature is the fix: there is no docKind or
 * channel parameter, so a quote text and an invoice text cannot legally
 * resolve differently for the same contractor + same pick.
 *
 * Pure logic, no side effects.
 */

export type CommsLang = "en" | "es";

function normalize(value: string | null | undefined): CommsLang | undefined {
  const v = (value ?? "").trim().toLowerCase();
  return v === "en" || v === "es" ? v : undefined;
}

/**
 * Resolve the language an outbound send goes out in:
 *   1. the explicit per-send pick (assistant "Send in <lang>" / preview
 *      toggle) when present and valid;
 *   2. else the stored Settings default (identity.commsLanguage);
 *   3. else "en" — EN-by-default is the product's promise.
 * Trim/case tolerant; anything that is not "en"/"es" is treated as absent.
 */
export function resolveCommsLanguage(args: {
  override?: string | null;
  identityCommsLanguage?: string | null;
}): CommsLang {
  return normalize(args.override) ?? normalize(args.identityCommsLanguage) ??
    "en";
}

/**
 * REQ-348 (demo-loop cycle 1, m34) — the SET of languages a contractor can
 * send paperwork in (identity.commsLanguages, Settings → "Languages you send
 * in"), defaulted from the contractor's own language when they never picked:
 * a Spanish speaker sends in English AND Spanish — "Spanish in, English
 * out", English first so the default send language stays English — anyone
 * else in English. This is THE one rule; Settings, the onboarding wizard and
 * the backend's identity write all read it.
 */
export function defaultCommsLanguages(
  userLanguage: string | null | undefined,
): CommsLang[] {
  return normalize(userLanguage) === "es" ? ["en", "es"] : ["en"];
}

interface CommsLanguagesHolder {
  commsLanguages?: string[] | null;
  commsLanguage?: string | null;
}

function validList(list: string[] | null | undefined): CommsLang[] {
  const out: CommsLang[] = [];
  for (const v of list ?? []) {
    const n = normalize(v);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The languages this contractor sends in: the stored set when there is one;
 * else the legacy single `commsLanguage` (an account that picked one before
 * the set existed); else the default from their own language.
 */
export function sendLanguagesOf(
  identity: CommsLanguagesHolder | null | undefined,
  userLanguage: string | null | undefined,
): CommsLang[] {
  const stored = validList(identity?.commsLanguages);
  if (stored.length) return stored;
  const legacy = normalize(identity?.commsLanguage);
  if (legacy) return [legacy];
  return defaultCommsLanguages(userLanguage);
}

/**
 * What an identity write should seed into `commsLanguages`: the default from
 * the contractor's language when neither the stored record nor this write
 * carries a choice (no set, no legacy single language); `undefined` when there
 * is a choice to keep. Seeds the set only — never `commsLanguage`, so the
 * first send's adopt-the-pick rule (send-paperwork-sms/email) still runs.
 */
export function commsLanguagesSeed(
  existing: CommsLanguagesHolder | null | undefined,
  patch: CommsLanguagesHolder,
  userLanguage: string | null | undefined,
): CommsLang[] | undefined {
  const chosen = (h: CommsLanguagesHolder | null | undefined) =>
    validList(h?.commsLanguages).length > 0 || !!normalize(h?.commsLanguage);
  if (chosen(existing) || chosen(patch)) return undefined;
  return defaultCommsLanguages(userLanguage);
}

/**
 * REQ-500 (demo-loop cycle 3, M34) — at least one send-in language always
 * stays on. `true` when `code` is the only one ticked: Settings and the wizard
 * disable that box and show the keep-one hint.
 */
export function isLastSendLanguage(
  selected: readonly string[],
  code: string,
): boolean {
  const list = validList([...selected]);
  return list.length === 1 && list[0] === normalize(code);
}

/**
 * REQ-500 — the send-in list after ticking (`on`) or unticking `code`, in
 * en, es order; `null` when unticking would leave none (the write is refused,
 * never sent — the backend answers an empty list with 400).
 */
export function toggleSendLanguage(
  selected: readonly string[],
  code: string,
  on: boolean,
): CommsLang[] | null {
  const set = new Set<string>(validList([...selected]));
  const c = normalize(code);
  if (!c) return null;
  if (on) set.add(c);
  else set.delete(c);
  const list = (["en", "es"] as const).filter((l) => set.has(l));
  return list.length ? list : null;
}

/**
 * REQ-500 — a write that carries `commsLanguages` must name at least one
 * language we send in (en/es); an empty or all-unknown list is refused.
 */
export function hasSendLanguage(list: readonly string[]): boolean {
  return validList([...list]).length > 0;
}
