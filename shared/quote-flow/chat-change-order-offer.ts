/**
 * REQ-664 (demo-loop cycle 5, m43) — a signed quote's line edit OFFERS the
 * change order instead of only refusing.
 *
 * Pair 5 asked the assistant to make the signed Q-001's cabinets cheaper and
 * got "…is signed, so its lines can't change. Add or credit the difference
 * with a change order instead." with only "Open Q-001". The revise
 * coordinator knew the line and its new price, so the locked reply now
 * carries the difference on its payload (`quoteRevision.changeOrderOffer`).
 * The chat shows it as a one-tap "Make change order −$1,000 for Cabinets"
 * button on the newest message; the button sends those words, which the
 * server reads as the yes (`acceptsChangeOrderOffer`) and makes exactly that
 * change order. Both sides use `liveChangeOrderOffer`, so the server honours
 * only the offer the chat shows.
 */

export interface ChangeOrderOffer {
  /** The signed quote the change order is for. */
  quoteId: string;
  quoteNumber?: string;
  /** The difference, signed INTEGER CENTS (a credit is negative). */
  deltaCents: number;
  /** The change order's description ("Cabinets: $3,500.00 → $2,500.00"). */
  description: string;
  /** The lines it is for, as the quote names them ("Cabinets"). */
  label: string;
}

/** The offer on a locked revise reply's payload, if it carries a usable one. */
export function changeOrderOfferOf(
  payload: unknown,
): ChangeOrderOffer | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const rev = (payload as { quoteRevision?: unknown }).quoteRevision;
  if (!rev || typeof rev !== "object") return undefined;
  const { kind, changeOrderOffer } = rev as Record<string, unknown>;
  if (kind !== "locked") return undefined;
  if (!changeOrderOffer || typeof changeOrderOffer !== "object") {
    return undefined;
  }
  const { quoteId, quoteNumber, deltaCents, description, label } =
    changeOrderOffer as Record<string, unknown>;
  if (typeof quoteId !== "string" || !quoteId) return undefined;
  if (
    typeof deltaCents !== "number" || !Number.isFinite(deltaCents) ||
    Math.trunc(deltaCents) === 0
  ) {
    return undefined;
  }
  if (typeof description !== "string" || !description.trim()) {
    return undefined;
  }
  return {
    quoteId,
    ...(typeof quoteNumber === "string" && quoteNumber ? { quoteNumber } : {}),
    deltaCents: Math.trunc(deltaCents),
    description: description.trim(),
    label: typeof label === "string" && label.trim()
      ? label.trim()
      : description.trim(),
  };
}

/** The message fields the rule reads. */
export interface OfferMessage {
  id: string;
  role: string;
  payload?: unknown;
}

/** The offer still standing: the thread's NEWEST message is the assistant's
 *  locked reply carrying it. Anything said after it retires it. */
export function liveChangeOrderOffer(
  messages: readonly OfferMessage[],
): { id: string; offer: ChangeOrderOffer } | undefined {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return undefined;
  const offer = changeOrderOfferOf(last.payload);
  return offer ? { id: last.id, offer } : undefined;
}

/** "−$1,000" / "+$1,250.50" — cents only when there are any. */
export function signedOfferAmount(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  return (cents < 0 ? "−" : "+") + "$" + dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/[−‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[\s.!¡¿?,]+$/u, "")
    .trim();
}

/** A plain yes to the offer ("yes", "do it", "sí, hazlo"). */
const YES_RE =
  /^(?:y(?:es|eah|ep|up)|ok(?:ay)?|sure|please|do it|go ahead|make it|s[ií]|dale|hazlo|claro|va|vale)(?:[\s,!.]+(?:please|do it|go ahead|make it|hazlo|por favor|dale|thanks|gracias))*$/u;

/** Whether `text` takes the offer: the button's own words (any of
 *  `labels`, one per language) or a plain yes. */
export function acceptsChangeOrderOffer(
  text: string,
  labels: readonly string[],
): boolean {
  const said = norm(text);
  if (!said) return false;
  if (labels.some((l) => norm(l) === said)) return true;
  return YES_RE.test(said);
}
