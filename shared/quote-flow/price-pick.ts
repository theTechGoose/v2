/**
 * REQ-688 (demo-loop cycle 5, issue m65) — the price on the chat checklist.
 *
 * The chat's checklist is the terms wizard's pick log: user `text` messages
 * carrying `payload.wizardStepId`, drawn as a ✓ line. The price is picked on
 * the price card BEFORE the wizard, so no pick line ever named it and the
 * checklist read Customer / Start / Time / Payment with no price. When a
 * priced quote enters the wizard the server writes one "Price: $1,850.00"
 * line (wizardStepId "price"), stored as key + vars so it follows the EN/ES
 * switch (REQ-589); a later price edit rewrites it on the next thread read.
 *
 * "price" is not a wizard step: the line never becomes an agreement term row
 * and Back through the wizard never pops it.
 *
 * Dependency-free: imported by the backend (#quote-flow/) and the Jest unit
 * suite. Translation is injected.
 */
import type { ChatI18nRef, ChatTranslate } from "./chat-i18n.ts";
import { renderChatI18n } from "./chat-i18n.ts";

type Lang = "en" | "es";

/** The pick line's `payload.wizardStepId`. */
export const PRICE_PICK_STEP_ID = "price";

/** "$1,850.00" — the amount as the price card shows it. */
export function pricePickDollars(cents: number): string {
  const n = Math.round(cents) / 100;
  return `$${
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** The line's key + vars: "{label}: {value}" with label "Price"/"Precio". */
export function pricePickRef(cents: number): ChatI18nRef {
  return {
    key: "wizardAnswer.pick.transcript",
    vars: {
      label: { key: "wizardAnswer.pick.priceLabel" },
      value: pricePickDollars(cents),
    },
  };
}

export interface PricePickMessage {
  role: "user";
  kind: "text";
  content: string;
  payload: {
    i18n: ChatI18nRef;
    wizardStepId: typeof PRICE_PICK_STEP_ID;
    priceCents: number;
  };
}

/** The pick line for `cents`, rendered in `lang`. */
export function pricePickMessage(
  cents: number,
  lang: Lang,
  tr: ChatTranslate,
): PricePickMessage {
  const ref = pricePickRef(cents);
  return {
    role: "user",
    kind: "text",
    content: renderChatI18n(ref, lang, tr),
    payload: {
      i18n: ref,
      wizardStepId: PRICE_PICK_STEP_ID,
      priceCents: Math.round(cents),
    },
  };
}

/** True for the price pick line. */
export function isPricePick(
  m: { role?: string; kind?: string; payload?: unknown },
): boolean {
  return m.role === "user" && m.kind === "text" &&
    (m.payload as { wizardStepId?: unknown } | undefined)?.wizardStepId ===
      PRICE_PICK_STEP_ID;
}
