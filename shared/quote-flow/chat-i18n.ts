/**
 * REQ-589 (demo-loop cycle 4, M15 + m15) — assistant chat lines that follow
 * the EN/ES switch.
 *
 * The server writes some chat lines from the dictionary — the terms wizard's
 * divider, question, option labels and "Start: Next week" pick line, the
 * send divider and its SMS reason. It used to store only the text, rendered
 * in the contractor's language at that moment, so after a switch every old
 * line stayed in the old language. Each such line now also stores the key it
 * came from (`payload.i18n`); the island re-renders it in the live language
 * and falls back to the stored text for a row without one.
 *
 * Dependency-free: imported by the backend (#quote-flow/), the front-end
 * islands and the Jest unit suite. Translation is injected.
 */
import { formatTermDate } from "./format-helpers.ts";

type Lang = "en" | "es";

/** A value inside a key's vars: plain text/number (a customer's name), a
 *  nested key (a step label), or a date picked in the wizard (stored ISO,
 *  formatted in the reader's language). */
export type ChatI18nVar =
  | string
  | number
  | ChatI18nRef
  | { date: string }
  // REQ-589 AMENDMENT (REQ-585): a value already worded per language — a
  // custom duration the chat set ("2.5 weeks" / "2.5 semanas").
  | { byLang: Partial<Record<Lang, string>> };

/** A dictionary key plus its vars — enough to render the line in any
 *  language. */
export interface ChatI18nRef {
  key: string;
  vars?: Record<string, ChatI18nVar>;
}

/** `tFor(lang, key, vars)` (front-end) / `t(lang, key, vars)` (backend). */
export type ChatTranslate = (
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
) => string;

/** An option's keys: its label, and its sub-line with the vars it needs. */
export interface ChatOptionI18n {
  label: string;
  sub?: ChatI18nRef;
}

export function isChatI18nRef(x: unknown): x is ChatI18nRef {
  return !!x && typeof x === "object" &&
    typeof (x as { key?: unknown }).key === "string";
}

function renderVar(v: ChatI18nVar, lang: Lang, tr: ChatTranslate) {
  if (typeof v === "string" || typeof v === "number") return v;
  if (isChatI18nRef(v)) return renderChatI18n(v, lang, tr);
  if (v && typeof (v as { date?: unknown }).date === "string") {
    return formatTermDate((v as { date: string }).date, lang);
  }
  const byLang = (v as { byLang?: Partial<Record<Lang, string>> }).byLang;
  if (byLang && typeof byLang === "object") {
    return byLang[lang] ?? byLang.en ?? byLang.es ?? "";
  }
  return "";
}

/** Render a stored key + vars in `lang`. */
export function renderChatI18n(
  ref: ChatI18nRef,
  lang: Lang,
  tr: ChatTranslate,
): string {
  if (!ref.vars) return tr(lang, ref.key);
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(ref.vars)) {
    vars[k] = renderVar(v, lang, tr);
  }
  return tr(lang, ref.key, vars);
}

interface ChatPayload {
  i18n?: unknown;
  label?: unknown;
  options?: unknown;
  smsFailureI18n?: unknown;
  emailFailureI18n?: unknown;
  [k: string]: unknown;
}

/**
 * The message as the reader should see it in `lang`: its `content` (and a
 * divider's `payload.label`) from `payload.i18n`, each wizard option's
 * label/sub from its `i18n`, and a send divider's failure reasons from
 * `smsFailureI18n` / `emailFailureI18n`. A message with no key comes back
 * as the same object, untouched.
 */
export function localizeChatMessage<
  M extends { content: string; payload?: unknown },
>(m: M, lang: Lang, tr: ChatTranslate): M {
  const p = m.payload as ChatPayload | undefined;
  if (!p || typeof p !== "object") return m;
  const opts = Array.isArray(p.options) ? p.options : undefined;
  const hasOptionKeys = !!opts?.some((o) =>
    !!o && typeof o === "object" && (o as { i18n?: unknown }).i18n
  );
  if (
    !isChatI18nRef(p.i18n) && !hasOptionKeys &&
    !isChatI18nRef(p.smsFailureI18n) && !isChatI18nRef(p.emailFailureI18n)
  ) return m;

  const payload: ChatPayload = { ...p };
  let content = m.content;
  if (isChatI18nRef(p.i18n)) {
    content = renderChatI18n(p.i18n, lang, tr);
    if (typeof p.label === "string") payload.label = content;
  }
  if (hasOptionKeys) {
    payload.options = opts!.map((o) => {
      const keys = (o as { i18n?: ChatOptionI18n }).i18n;
      if (!keys || typeof keys.label !== "string") return o;
      return {
        ...(o as object),
        label: tr(lang, keys.label),
        ...(keys.sub ? { sub: renderChatI18n(keys.sub, lang, tr) } : {}),
      };
    });
  }
  if (isChatI18nRef(p.smsFailureI18n)) {
    payload.smsFailureReason = renderChatI18n(p.smsFailureI18n, lang, tr);
  }
  if (isChatI18nRef(p.emailFailureI18n)) {
    payload.emailFailureReason = renderChatI18n(p.emailFailureI18n, lang, tr);
  }
  return { ...m, content, payload };
}

/** The thread-list preview in `lang`: from its key when the server stored
 *  one, else the stored text. */
export function localizedPreview(
  conv: { preview?: string; previewI18n?: unknown },
  lang: Lang,
  tr: ChatTranslate,
): string | undefined {
  if (isChatI18nRef(conv.previewI18n)) {
    return renderChatI18n(conv.previewI18n, lang, tr);
  }
  return conv.preview;
}
