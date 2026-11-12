/**
 * REQ-625 — a customer's address in parts (street, city, state, zip: the
 * shape a QuickBooks customer export carries) and the ONE composed string
 * every existing reader uses (`customer.address`: invoice bill-to + service
 * address, quotes, field tasks/subscriptions, the CSV export, search).
 *
 * Pure; shared by the backend store (which composes on every write) and the
 * front-end customer form (which splits a legacy address to prefill an edit).
 */

export interface AddressParts {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export const ADDRESS_PART_KEYS = ["street", "city", "state", "zip"] as const;
export type AddressPartKey = typeof ADDRESS_PART_KEYS[number];

const clean = (s: string | undefined | null): string =>
  typeof s === "string" ? s.trim() : "";

/** "12 Oak St, Austin, TX 78701" — empty parts leave no stray separators. */
export function composeAddress(p: AddressParts): string {
  const stateZip = [clean(p.state), clean(p.zip)].filter(Boolean).join(" ");
  return [clean(p.street), clean(p.city), stateZip].filter(Boolean).join(", ");
}

const STATE_ZIP = /^(.*?)\s*(\d{5}(?:-\d{4})?)$/;

/**
 * Best-effort read of a free-text / composed address back into parts, to
 * prefill an edit of a customer saved before the parts existed. Anything it
 * cannot read stays whole in `street` — never lost.
 */
export function splitAddress(address: string | undefined | null): AddressParts {
  const raw = clean(address);
  if (!raw) return {};
  const segs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return { street: raw };
  const last = segs[segs.length - 1];
  const m = last.match(STATE_ZIP);
  const out: AddressParts = {};
  let rest = segs;
  if (m) {
    if (m[1]) out.state = m[1];
    out.zip = m[2];
    rest = segs.slice(0, -1);
  } else if (/^[A-Za-z]{2}$/.test(last)) {
    out.state = last;
    rest = segs.slice(0, -1);
  }
  if (rest.length >= 2) {
    out.city = rest[rest.length - 1];
    out.street = rest.slice(0, -1).join(", ");
  } else if (rest.length === 1) {
    if (out.state || out.zip) out.street = rest[0];
    else return { street: raw };
  }
  // keep key order stable: street, city, state, zip
  const ordered: AddressParts = {};
  for (const k of ADDRESS_PART_KEYS) {
    if (out[k] !== undefined) ordered[k] = out[k];
  }
  return ordered;
}

/** Did this payload carry any address part (even an empty one = a clear)? */
export function touchesParts(p: Record<string, unknown>): boolean {
  return ADDRESS_PART_KEYS.some((k) => p[k] !== undefined);
}
