/**
 * REQ-625 — a customer's address in parts (street, city, state, zip: the
 * shape a QuickBooks customer export carries) and the ONE composed string
 * every existing reader uses (`customer.address`: invoice bill-to + service
 * address, quotes, field tasks/subscriptions, the CSV export, search).
 *
 * Pure; shared by the backend store (which composes on every write) and the
 * front-end customer form (which splits a legacy address to prefill an edit).
 */
import { stateCode } from "./rules.ts"; // REQ-1047

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

/** Street-type words written after the street's name ("Oak Hollow Dr"). */
const STREET_TYPE_WORDS = new Set(
  (
    "st street ave av avenue rd road dr drive blvd boulevard ln lane ct " +
    "court way pl place pkwy parkway cir circle ter terrace trl trail hwy " +
    "highway cv cove sq square loop"
  ).split(" "),
);
/** Street types written BEFORE the name ("4410 Avenue F", "5100 Highway 71"). */
const STREET_TYPE_FIRST_WORDS = new Set(
  "avenue ave highway hwy route rte fm cr".split(" "),
);
/** Small words kept lower case inside a name ("Calle del Sol"). */
const LOWER_CONNECTORS = new Set("de del of the y in en at".split(" "));
/** Words written all upper case ("NE 5th St", "PO Box 12"). */
const UPPER_WORDS = new Set("ne nw se sw po".split(" "));
const ZIP_TOKEN = /^\d{5}(?:-\d{4})?$/;
const LOWER_WORD = /^\p{Ll}[\p{Ll}'’-]*$/u;

/**
 * REQ-1047 (LOOP-007 cycle 2, q2-33) — a quote's service address, tidy
 * whichever source supplied it (the typed text or the model's value):
 *   "1418 oak hollow dr austin tx 78745" → "1418 Oak Hollow Dr, Austin, TX 78745"
 *   "905 calle del sol san antonio tx 78207" → "905 Calle del Sol San Antonio, TX 78207"
 * Lower-case words are title-cased (connectors such as "del" stay lower
 * inside a name), a 2-letter state before the ZIP (or after a final comma) is
 * upper-cased, and ", " goes before the city and the state where they can be
 * read. REQ-1088 (LOOP-007 q3-5/q3-6): the commas follow the address's
 * STRUCTURE, not its letter case — a recognised state before a ZIP gets ", "
 * before it whenever none is there ("2210 Burnet Rd Austin TX 78757",
 * "4410 avenue h, austin tx 78751"), and the street's end (a street-type
 * word) gets one when nothing separates the street from the city yet. Words
 * already in mixed or upper case, numbers and anything it cannot read are
 * never changed, so an already-formatted address comes back exactly as it
 * was. Pure.
 */
export function tidyServiceAddress(raw: string): string {
  const s = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!s) return s;
  const toks = s.split(" ").map((t) => {
    const m = /^(.*?)([,;.]*)$/.exec(t)!;
    return { core: m[1], punct: m[2] };
  });
  const n = toks.length;
  const lowerCore = (i: number) => toks[i].core.toLowerCase();

  // where the state sits: right before the ZIP, or last after a comma
  let stateIdx = -1;
  if (n >= 2 && ZIP_TOKEN.test(toks[n - 1].core)) stateIdx = n - 2;
  else if (n >= 2 && toks[n - 2].punct.includes(",")) stateIdx = n - 1;
  if (
    stateIdx >= 1 && !(/^\p{L}{2}$/u.test(toks[stateIdx].core) &&
      stateCode(toks[stateIdx].core))
  ) stateIdx = -1;

  const out = toks.map((t, i) => {
    if (i === stateIdx) return { ...t, core: t.core.toUpperCase() };
    if (!LOWER_WORD.test(t.core)) return t;
    const w = t.core;
    if (UPPER_WORDS.has(w)) return { ...t, core: w.toUpperCase() };
    const segStart = i === 0 || toks[i - 1].punct.includes(",") ||
      /^\d/.test(toks[i - 1].core);
    if (LOWER_CONNECTORS.has(w) && !segStart && i < n - 1) return t;
    return { ...t, core: w[0].toUpperCase() + w.slice(1) };
  });

  // a state read from a trailing ZIP (not from a final comma) with no comma
  // before it yet: ", " before the state …
  if (
    stateIdx >= 1 && ZIP_TOKEN.test(toks[n - 1].core) &&
    !toks[stateIdx - 1].punct.includes(",")
  ) {
    out[stateIdx - 1] = { ...out[stateIdx - 1], punct: "," };
  }
  // … and before the city, when the street's end can be read and no comma
  // already separates the street from the city
  const streetSeparated = toks.slice(0, Math.max(0, stateIdx - 1)).some((t) =>
    t.punct.includes(",")
  );
  if (stateIdx >= 2 && !streetSeparated && /^\d/.test(toks[0].core)) {
    let streetEnd = -1;
    if (STREET_TYPE_FIRST_WORDS.has(lowerCore(1)) && stateIdx > 3) {
      streetEnd = 2; // "4410 avenue f austin tx …"
    } else {
      for (let i = stateIdx - 2; i >= 2; i--) {
        if (STREET_TYPE_WORDS.has(lowerCore(i))) {
          streetEnd = i;
          break;
        }
      }
    }
    if (streetEnd > 0 && streetEnd < stateIdx - 1) {
      out[streetEnd] = { ...out[streetEnd], punct: "," };
    }
  }
  return out.map((t) => t.core + t.punct).join(" ");
}

/**
 * REQ-1088 (LOOP-007 q3-5/q3-6): a document write (quote / invoice create,
 * update, pending revision) with its `serviceAddress` — and an invoice's
 * typed `billTo.address` — tidied, so every writer (chat, wizard, New
 * invoice form, API) stores the same tidy address. Fields the write does not
 * carry (or carries as null = clear) are left alone; returns a copy.
 */
export function withTidyAddresses<T extends object>(write: T): T {
  const w = write as Record<string, unknown>;
  const out: Record<string, unknown> = { ...w };
  if (typeof w.serviceAddress === "string") {
    out.serviceAddress = tidyServiceAddress(w.serviceAddress);
  }
  const billTo = w.billTo as Record<string, unknown> | null | undefined;
  if (
    billTo && typeof billTo === "object" && typeof billTo.address === "string"
  ) {
    out.billTo = { ...billTo, address: tidyServiceAddress(billTo.address) };
  }
  return out as T;
}
