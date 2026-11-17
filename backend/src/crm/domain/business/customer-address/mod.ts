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
 */
import {
  ADDRESS_PART_KEYS,
  type AddressParts,
  composeAddress,
  touchesParts,
} from "#customer-address/mod.ts";

type WithAddress = AddressParts & { address?: string };

export function addressWrite(
  existing: WithAddress | undefined,
  patch: WithAddress,
): WithAddress {
  if (touchesParts(patch as Record<string, unknown>)) {
    const merged: AddressParts = {};
    for (const k of ADDRESS_PART_KEYS) {
      const v = patch[k] !== undefined ? patch[k] : existing?.[k];
      if (v !== undefined) merged[k] = typeof v === "string" ? v.trim() : v;
    }
    return { ...merged, address: composeAddress(merged) };
  }
  if (patch.address !== undefined) {
    return {
      address: patch.address,
      street: undefined,
      city: undefined,
      state: undefined,
      zip: undefined,
    };
  }
  return {};
}
