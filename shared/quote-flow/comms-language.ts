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
