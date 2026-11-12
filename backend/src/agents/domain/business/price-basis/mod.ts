/**
 * REQ-332 (demo cycle 1, m30): what the suggested prices include.
 *
 * "Prices include labor and materials" used to be a constant on every
 * result — the contractor's "they're buying the vanity themselves" never
 * reached it. The basis is now READ OFF THE JOB: when the raw message or the
 * confirmed scope says the customer supplies an item (or the work is labor
 * only / materials not included), the tiers are "labor; materials as noted".
 */

export type PriceBasis = "labor_and_materials" | "labor_materials_as_noted";

/** Who, other than the contractor, can be said to supply materials. */
const CUSTOMER =
  /\b(customers?|clients?|home ?owners?|owners?|tenants?|landlords?|they|she|he|clientes?|clientas?|dueñ[oa]s?|propietari[oa]s?|inquilin[oa]s?|ellos|ellas|ella|él)\b/i;

/** Supplying verbs, English + Spanish, in the forms a contractor types. */
const SUPPLIES =
  /\b(buy|buys|buying|bought|purchas\w*|suppl(?:y|ies|ied|ying)|provid(?:e|es|ed|ing)|furnish\w*|bring\w*|brought|pick(?:ed|s)? out|already (?:has|have|got|own|owns)|has their own|have their own|compr\w+|pone|ponen|pondr\w+|puso|pusieron|trae|traen|traer\w*|trajo|trajeron|prove\w+|suministr\w+|aport\w+|ya tiene\w*|ya compr\w+)\b/i;

/** "customer-supplied vanity", "owner provided cabinets". */
const COMPOUND =
  /\b(customer|client|home ?owner|owner|tenant)[- ](supplied|provided|furnished|purchased|bought)\b/i;

/** The contractor speaking of their own buying — "I'll buy the paint",
 *  "customer wants us to pick up the tile". */
const FIRST_PERSON =
  /\b(i|i'll|i'm|we|we'll|we're|us|our|me|my|yo|nosotros|nos|nuestr[oa]s?)\b/i;

/** Blanket statements that need no subject. */
const BLANKET =
  /\b(labou?r[- ]only|only labou?r|materials? (?:are |is )?(?:not|n't|aren't|isn't) included|no materials|excluding materials|materials? excluded|s[oó]lo mano de obra|solamente mano de obra|mano de obra solamente|mano de obra nada m[aá]s|materiales? no incluid[oa]s?|sin materiales|materiales (?:por cuenta|a cargo) del cliente|materiales del cliente)\b/i;

/**
 * Derive the pricing basis from the contractor's original message and the
 * scope they confirmed. Clause by clause (sentence / line / comma / dash):
 * a clause where the customer supplies something — and the contractor is
 * not the one buying — makes the basis "labor; materials as noted".
 */
export function deriveBasis(raw: string, scope = ""): PriceBasis {
  const text = `${raw}\n${scope}`;
  if (BLANKET.test(text) || COMPOUND.test(text)) {
    return "labor_materials_as_noted";
  }
  for (const clause of text.split(/[.;,\n—–()]+/)) {
    if (!CUSTOMER.test(clause) || !SUPPLIES.test(clause)) continue;
    if (FIRST_PERSON.test(clause)) continue;
    return "labor_materials_as_noted";
  }
  return "labor_and_materials";
}
