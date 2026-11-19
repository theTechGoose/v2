/**
 * REQ-625 — what a customer write does to the address fields.
 *
 * - The payload carries any part (street/city/state/zip, "" = clear that
 *   part): the parts merge over the stored ones and `address` is recomposed
 *   from them, so every reader of the one `address` string sees the edit.
 * - The payload carries only a free-text `address` (older writers — the
 *   assistant's tools, imports): it is stored as given and the parts are
 *   dropped, so stale parts never disagree with the address.
 * - Neither: nothing about the address changes.
 *
 * REQ-1088 (LOOP-007 q3-5/q3-6): whatever the writer typed, the stored
 * address is tidy — each part title-cased (a 2-letter state upper case) and
 * a free-text address run through `tidyServiceAddress`, so the customer
 * header, the invoice bill-to and a quote copied from the record never print
 * "45 palmetto dr, conway, sc 29526". A formatted address is unchanged.
 */
import {
  ADDRESS_PART_KEYS,
  type AddressParts,
  composeAddress,
  tidyServiceAddress,
  touchesParts,
} from "#customer-address/mod.ts";

/** REQ-1088: one part, tidy — the state upper case, words title-cased. */
function tidyPart(k: keyof AddressParts, v: string): string {
  const t = v.trim();
  if (k === "state") return /^\p{L}{2}$/u.test(t) ? t.toUpperCase() : t;
  if (k === "zip") return t;
  return tidyServiceAddress(t);
}

type WithAddress = AddressParts & { address?: string };

export function addressWrite(
  existing: WithAddress | undefined,
  patch: WithAddress,
): WithAddress {
  if (touchesParts(patch as Record<string, unknown>)) {
    const merged: AddressParts = {};
    for (const k of ADDRESS_PART_KEYS) {
      const v = patch[k] !== undefined ? patch[k] : existing?.[k];
      if (v !== undefined) {
        merged[k] = typeof v === "string" ? tidyPart(k, v) : v;
      }
    }
    return { ...merged, address: composeAddress(merged) };
  }
  if (patch.address !== undefined) {
    return {
      address: typeof patch.address === "string"
        ? tidyServiceAddress(patch.address)
        : patch.address,
      street: undefined,
      city: undefined,
      state: undefined,
      zip: undefined,
    };
  }
  return {};
}
