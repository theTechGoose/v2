/**
 * REQ-715 (demo-loop cycle 5, m31 + c2-M29 + c3-m43 + c4-M34) — the
 * customer's language: Not set / English / Español. Every send to the
 * customer starts in it (shared/quote-flow/comms-language.ts); "Not set"
 * leaves the contractor's default from Settings in charge. One control for
 * the New customer form, the card and the New invoice modal's new client.
 */
import { type Lang, tFor } from "../lib/i18n.ts";

/** "" is "Not set". */
export type CustomerLanguageValue = "" | "en" | "es";

/** The languages by their own names — the same in every UI language. */
const OPTIONS: readonly [CustomerLanguageValue, string][] = [
  ["", "customer.language.unset"],
  ["en", "customer.language.en"],
  ["es", "customer.language.es"],
];

/** A stored language as the select's value ("" when none). */
export function customerLanguageValue(
  v: string | null | undefined,
): CustomerLanguageValue {
  return v === "en" || v === "es" ? v : "";
}

export default function CustomerLanguageSelect(
  props: {
    lang: Lang;
    value: string | null | undefined;
    onChange: (next: CustomerLanguageValue) => void;
    id?: string;
    disabled?: boolean;
    style?: string;
    "data-cy"?: string;
    "aria-label"?: string;
  },
) {
  const current = customerLanguageValue(props.value);
  return (
    <select
      id={props.id}
      data-cy={props["data-cy"]}
      aria-label={props["aria-label"]}
      value={current}
      disabled={props.disabled}
      onChange={(e) =>
        props.onChange(
          customerLanguageValue((e.target as HTMLSelectElement).value),
        )}
      style={props.style}
    >
      {OPTIONS.map(([v, key]) => (
        <option key={v} value={v} selected={v === current}>
          {tFor(props.lang, key)}
        </option>
      ))}
    </select>
  );
}
