/**
 * Free-form US address parsing.
 *
 * Shared, framework-free business logic. `extractAddressOnly` originally lived
 * in the agents onboarding parser (the chat's "paste it on one line" reply);
 * hoisted here so the users/profile address save path can split a one-line
 * street with the same parser (REQ-420, demo-loop cycle 2 m28) without pulling
 * the agents module into compilation. The onboarding module re-exports it.
 */

import { US_STATES } from "@core/business/us-states/mod.ts";

const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

export interface ParsedAddress {
  street?: string;
  city?: string;
  state?: string;
  postal?: string;
}

/** Free-form US-address parser. Aimed at the onboarding "paste it on one
 *  line" reply. Handles the common shapes:
 *    "123 Main St, Austin, TX 78701"
 *    "123 Main St, Austin TX 78701"
 *    "123 Main St Austin TX 78701"
 *    "Austin, TX 78701"          (city + state + zip, no street)
 *    "TX 78701"                   (state + zip only)
 *    "78701"                      (zip only)
 *  Returns whatever fields it could pull. The caller decides if enough
 *  was captured to consider the question answered. */
export function extractAddressOnly(input: string): ParsedAddress | undefined {
  if (!input) return undefined;
  const raw = input.trim().replace(/\s+/g, " ");
  if (!raw) return undefined;
  if (raw.length > 180) return undefined;
  // Pull a 5-digit (optional +4) zip if present.
  const zipMatch = raw.match(/\b(\d{5})(?:-?\d{4})?\b/);
  const postal = zipMatch?.[1];
  // Pull a state — either 2-letter code or full name.
  let state: string | undefined;
  const codeMatch = raw.match(/\b([A-Za-z]{2})\b\s*(?:\d{5})?$/);
  if (codeMatch) {
    const cand = codeMatch[1].toUpperCase();
    if (US_STATES[cand]) state = cand;
  }
  if (!state) {
    for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
      const re = new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(raw)) {
        state = code;
        break;
      }
    }
  }
  // Strip zip + state from the end so we can split the rest by commas.
  let rest = raw;
  if (postal) {
    rest = rest.replace(new RegExp(`\\b${postal}(?:-?\\d{4})?\\b\\s*$`), "")
      .trim();
  }
  if (state) {
    rest = rest.replace(new RegExp(`\\b${state}\\b\\s*$`, "i"), "").trim();
    rest = rest.replace(new RegExp(`,?\\s*${state}\\s*,?$`, "i"), "").trim();
    // A spelled-out state ("Austin, Texas 78701") is stripped too, or it
    // would be read as the city (REQ-420).
    rest = rest.replace(
      new RegExp(
        `,?\\s*${US_STATES[state].replace(/\s+/g, "\\s+")}\\s*,?$`,
        "i",
      ),
      "",
    ).trim();
  }
  // Drop trailing commas/whitespace.
  rest = rest.replace(/[,\s]+$/, "");
  // Split remaining on commas. Last part = city, anything before = street.
  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  let street: string | undefined;
  let city: string | undefined;
  if (parts.length >= 2) {
    city = parts[parts.length - 1];
    street = parts.slice(0, -1).join(", ");
  } else if (parts.length === 1) {
    // Heuristic: if it starts with a number, treat as street, else as city.
    if (/^\d/.test(parts[0])) street = parts[0];
    else city = parts[0];
  }
  // Refuse near-empty parses (we want at least state+zip OR city).
  if (!street && !city && !state && !postal) return undefined;
  return {
    ...(street ? { street } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(postal ? { postal } : {}),
  };
}

export interface AddressFields {
  street?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
}

/** Does `text` end with a US state — the 2-letter code or the full name —
 *  optionally followed by a ZIP / ZIP+4? */
export function endsWithState(text: string, code: string): boolean {
  const name = US_STATES[code.toUpperCase()];
  if (!name) return false;
  const alt = `${code.toUpperCase()}|${name.replace(/\s+/g, "\\s+")}`;
  return new RegExp(
    `(?:^|[,\\s])(?:${alt})\\.?(?:\\s+\\d{5}(?:-?\\d{4})?)?$`,
    "i",
  )
    .test(text);
}

/** The address save path's guard for a whole one-line address typed into the
 *  Street box (REQ-420, demo-loop cycle 2 m28: the /welcome address step saved
 *  `{street: "1200 E Cesar Chavez St, Austin, TX 78702", state: "TX"}`, and
 *  every one-line render then read "…, TX 78702, TX").
 *
 *  When `street` holds a comma and ends with a state and/or ZIP, it is split
 *  with `extractAddressOnly`: `street` keeps only the street part and city,
 *  state and postal are filled where the caller left them empty (a value the
 *  caller sent always wins). A plain street — "123 Main St", "123 Main St,
 *  Suite 200" — comes back untouched. */
export function splitOneLineStreet<T extends AddressFields>(
  input: T,
): T & AddressFields {
  const street = input.street?.trim();
  if (!street || !street.includes(",")) return input;
  const parsed = extractAddressOnly(street);
  if (!parsed?.street || parsed.street === street) return input;
  const tailZip = /\b\d{5}(?:-?\d{4})?$/.test(street);
  const tailState = !!parsed.state && endsWithState(street, parsed.state);
  if (!tailZip && !tailState) return input;
  const fill = (cur: string | undefined, next: string | undefined) =>
    cur?.trim() ? cur : next;
  const city = fill(input.city, parsed.city);
  const state = fill(input.state, tailState ? parsed.state : undefined);
  const postal = fill(input.postal, tailZip ? parsed.postal : undefined);
  return {
    ...input,
    street: parsed.street,
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(postal ? { postal } : {}),
  };
}
