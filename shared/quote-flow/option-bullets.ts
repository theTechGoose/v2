/**
 * REQ-266 (demo issue ai-assistant-p7-options) / REQ-330 (demo cycle 1:
 * M21, M23, p15-7) — what one job option's bullets are allowed to be, and
 * how a set of options is kept honest. Shared by the options coordinator
 * (model reply + heuristic fallback) and the island's last-resort fallback
 * and edit-reopen, so no path quietly cuts a long job or paints two cards
 * with the same scope.
 *
 * There is NO bullet cap (REQ-330): a fourteen-item gut job keeps all
 * fourteen lines. The prompt asks the model to GROUP related items past
 * twelve, never to drop one; the picker scrolls.
 */

import { extractCustomerName } from "./quick-quote-prefill.ts";
import { extractEmail, extractPhone } from "./quote-facts.ts";
import type { VersionStyle } from "./version-titles.ts";

/** The "· Wider scope" version: EVERY bullet plus jobsite cleanup (once) —
 *  never fewer items than the full version. */
export function widerBullets(bullets: string[], cleanup: string): string[] {
  const key = cleanup.toLowerCase();
  const has = bullets.some((b) => b.toLowerCase() === key);
  return has ? bullets.slice() : [...bullets, cleanup];
}

/** One bullet's identity: case, inner spacing and trailing punctuation are
 *  not scope differences. */
export function bulletKey(bullet: string): string {
  return bullet.trim().replace(/\s+/g, " ").replace(/[.;:,!]+$/, "")
    .toLowerCase();
}

/** True when two bullet lists describe the same scope (same lines, same
 *  order, modulo case / spacing / trailing punctuation). */
export function sameBullets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (bulletKey(a[i]) !== bulletKey(b[i])) return false;
  }
  return true;
}

/** REQ-330 (p15-7): options whose bullet sets are equal collapse to the
 *  first one — the picker never shows "Shingle Replacement" and "Roof
 *  Shingle Installation" with the identical list. Order is kept. */
export function dedupeOptionsByBullets<T extends { bullets: string[] }>(
  options: readonly T[],
): T[] {
  const out: T[] = [];
  for (const o of options) {
    if (out.some((k) => sameBullets(k.bullets, o.bullets))) continue;
    out.push(o);
  }
  return out;
}

/** Shape of one picker option as both the server and the island see it. */
export interface PickerOption {
  id: string;
  jobName: string;
  summary: string;
  bullets: string[];
  byLang?: Record<
    string,
    { jobName: string; summary: string; bullets: string[] }
  >;
}

/** Stable id of the "what you have now" option on an edit-reopen. */
export const CURRENT_OPTION_ID = "current";

/**
 * REQ-330 (M23): the review card's current job details as a picker option —
 * every line verbatim, the title and summary kept, never regenerated or
 * capped. Seeded first and pre-selected when the pencil reopens the picker,
 * so an edit starts from what the contractor already has.
 */
export function currentDetailsOption(input: {
  lines: readonly string[];
  jobName?: string | null;
  summary?: string | null;
  byLang?: PickerOption["byLang"];
}): PickerOption {
  const bullets = input.lines.map((l) => l.trim()).filter((l) => l.length > 0);
  const jobName = (input.jobName ?? "").trim() ||
    (bullets[0] ?? "").split(/\s+/).slice(0, 3).join(" ");
  const summary = (input.summary ?? "").trim() || jobName;
  const out: PickerOption = {
    id: CURRENT_OPTION_ID,
    jobName,
    summary,
    bullets,
  };
  if (input.byLang) out.byLang = input.byLang;
  return out;
}

/** The seeded picker: the current option first, then every generated
 *  alternative whose bullets differ from it (and from each other). */
export function seedPickerOptions<T extends PickerOption>(
  current: T,
  generated: readonly T[] | null | undefined,
): T[] {
  return dedupeOptionsByBullets([current, ...(generated ?? [])]);
}

// ── REQ-400 (demo-loop cycle 2, M21): every version is the WHOLE job ───────
// Pair 7's master-bath gut came back as three "versions" that each held a
// third of the job (v1 tub out / curbless shower / tile, v2 drain + niche /
// glass / vanity, v3 drain move / fan + lights / heated floor) and nothing
// checked it. An option is a version of the job when it MENTIONS every item
// the job has — grouping and rewording allowed, leaving items out not.

/** Words that name no scope item on their own: function words, generic trade
 *  verbs ("install", "remove"), "new", "complete", numbers in words. */
const FILLER_TERMS = new Set([
  // EN
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "per",
  "all",
  "any",
  "each",
  "both",
  "its",
  "their",
  "this",
  "that",
  "these",
  "those",
  "our",
  "your",
  "his",
  "her",
  "out",
  "off",
  "over",
  "under",
  "new",
  "old",
  "existing",
  "install",
  "installs",
  "installed",
  "installing",
  "installation",
  "remove",
  "removes",
  "removed",
  "removing",
  "removal",
  "replace",
  "replaces",
  "replaced",
  "replacing",
  "replacement",
  "repair",
  "repairs",
  "repaired",
  "repairing",
  "full",
  "complete",
  "completed",
  "entire",
  "whole",
  "total",
  "master",
  "remodel",
  "remodeling",
  "remodelling",
  "renovation",
  "renovate",
  "renovating",
  "upgrade",
  "upgrades",
  "upgraded",
  "project",
  "job",
  "jobs",
  "work",
  "works",
  "service",
  "services",
  "labor",
  "labour",
  "material",
  "materials",
  "provide",
  "provided",
  "providing",
  "include",
  "includes",
  "including",
  "included",
  "needed",
  "required",
  "are",
  "was",
  "were",
  "will",
  "can",
  "also",
  "plus",
  "only",
  "just",
  "more",
  "less",
  "about",
  "approx",
  "approximately",
  "every",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "customer",
  "client",
  "owner",
  "homeowner",
  "call",
  "text",
  "contact",
  "then",
  "before",
  "after",
  "during",
  "while",
  "add",
  "added",
  "adding",
  "prep",
  "prepare",
  "preparation",
  // ES (accents stripped)
  "los",
  "las",
  "del",
  "con",
  "para",
  "por",
  "una",
  "uno",
  "unos",
  "unas",
  "sin",
  "sus",
  "que",
  "como",
  "mas",
  "todo",
  "toda",
  "todos",
  "todas",
  "este",
  "esta",
  "estos",
  "estas",
  "ese",
  "esa",
  "nuevo",
  "nueva",
  "nuevos",
  "nuevas",
  "viejo",
  "vieja",
  "viejos",
  "viejas",
  "antiguo",
  "antigua",
  "antiguos",
  "antiguas",
  "existente",
  "existentes",
  "actual",
  "actuales",
  "instalar",
  "instala",
  "instalado",
  "instalada",
  "instalados",
  "instalacion",
  "instalaciones",
  "retirar",
  "retiro",
  "retirado",
  "quitar",
  "remover",
  "remocion",
  "reemplazar",
  "reemplazo",
  "reemplazado",
  "cambiar",
  "cambio",
  "reparar",
  "reparacion",
  "reparado",
  "completo",
  "completa",
  "completos",
  "totales",
  "remodelacion",
  "remodelar",
  "renovacion",
  "renovar",
  "mejora",
  "mejoras",
  "proyecto",
  "trabajo",
  "trabajos",
  "servicio",
  "servicios",
  "mano",
  "obra",
  "materiales",
  "incluye",
  "incluido",
  "incluida",
  "incluir",
  "incluyendo",
  "tambien",
  "principal",
  "cliente",
  "clienta",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "preparar",
  "preparacion",
  "agregar",
  "anadir",
  "cada",
  "llamar",
  "contactar",
  "avisar",
  "notify",
  "email",
  "correo",
  "telefono",
  "phone",
]);

/** One scope line's content terms: lowercase, accents and punctuation off,
 *  filler words and bare numbers dropped ("12x24", "60in" stay). */
export function scopeTerms(line: string): string[] {
  return (line ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && /\p{L}/u.test(w) && !FILLER_TERMS.has(w));
}

/** Two terms name the same thing when they share their first letters — up to
 *  five, at least three: "gut"/"gutted", "tile"/"tiles", "install"/
 *  "installation", "baño"/"baños". */
export function sameTerm(a: string, b: string): boolean {
  const k = Math.min(5, a.length, b.length);
  return k >= 3 && a.slice(0, k) === b.slice(0, k);
}

function mentions(terms: readonly string[], item: readonly string[]): boolean {
  return item.some((t) => terms.some((s) => sameTerm(s, t)));
}

/** Indexes of the lines that each name something no earlier line did — the
 *  job's distinct items, in order (a reworded repeat adds nothing). */
export function distinctScopeIndexes(lines: readonly string[]): number[] {
  const seen: string[] = [];
  const out: number[] = [];
  lines.forEach((line, i) => {
    const terms = scopeTerms(line);
    if (!terms.some((t) => !seen.some((s) => sameTerm(s, t)))) return;
    out.push(i);
    seen.push(...terms);
  });
  return out;
}

/** The job's distinct scope items across `lines`, each once, in order. */
export function distinctScopeItems(lines: readonly string[]): string[] {
  return distinctScopeIndexes(lines).map((i) => lines[i]);
}

/** The items `bullets` never mention (an item naming nothing is never
 *  missed). */
export function missedScopeItems(
  bullets: readonly string[],
  items: readonly string[],
): string[] {
  const terms = bullets.flatMap(scopeTerms);
  return items.filter((item) => {
    const it = scopeTerms(item);
    return it.length > 0 && !mentions(terms, it);
  });
}

/** How many of a job's items a version may leave unmentioned and still be
 *  the whole job — none under five; then one in five, for wording drift (a
 *  synonym, an item folded into another's line, an added cleanup line). */
export function allowedMisses(itemCount: number): number {
  return Math.floor(itemCount / 5);
}

/**
 * REQ-400 (M21): which options are versions of the WHOLE job and which hold
 * only part of it. The job's items are the distinct items across every
 * option; an option that leaves out more than allowedMisses of them is a
 * part — the demo's three thirds are all parts (none is complete).
 */
export function partitionByCoverage<T extends { bullets: string[] }>(
  options: readonly T[],
): { complete: T[]; partial: T[]; items: string[] } {
  const items = distinctScopeItems(options.flatMap((o) => o.bullets));
  const allowed = allowedMisses(items.length);
  const complete: T[] = [];
  const partial: T[] = [];
  for (const o of options) {
    (missedScopeItems(o.bullets, items).length <= allowed ? complete : partial)
      .push(o);
  }
  return { complete, partial, items };
}

// ── REQ-446 (demo-loop cycle 3, m13): roles, and the pick that survives ───
// "three near-identical options … a refinement resets her chosen card to
// card 1." Each version names its role, and a rewrite keeps the pick.

/** How much one version says: its lines, then its characters. */
function detailOf(bullets: readonly string[]): [number, number] {
  const lines = bullets.filter((b) => b.trim().length > 0);
  return [lines.length, lines.reduce((n, b) => n + b.trim().length, 0)];
}

/**
 * REQ-446: each version's role by how much it says — the least detailed is
 * "concise", the most "detailed", the one between "standard" (two versions:
 * concise and detailed; one version: no role). The options keep their
 * order; equal detail keeps the model's order (it is asked for concise,
 * standard, detailed in that order).
 */
export function labelVersionStyles<T extends { bullets: string[] }>(
  options: readonly T[],
): Array<T & { style?: VersionStyle }> {
  if (options.length < 2) {
    return options.map((o) => {
      const { style: _drop, ...rest } = o as T & { style?: VersionStyle };
      return rest as T & { style?: VersionStyle };
    });
  }
  const ranked = options
    .map((o, i) => ({ i, d: detailOf(o.bullets) }))
    .sort((a, b) => a.d[0] - b.d[0] || a.d[1] - b.d[1] || a.i - b.i);
  const roles: VersionStyle[] = options.length === 2
    ? ["concise", "detailed"]
    : ["concise", "standard", "detailed"];
  const styleAt = new Map<number, VersionStyle>();
  ranked.forEach((r, rank) => {
    // past three versions the middle ones are all "standard"
    const role = rank === 0
      ? roles[0]
      : rank === ranked.length - 1
      ? roles[roles.length - 1]
      : "standard";
    styleAt.set(r.i, role);
  });
  return options.map((o, i) => ({ ...o, style: styleAt.get(i) }));
}

/** A bullet as the picker holds it: a line, or a draft that may be struck. */
type PickBullet = string | { text: string; deleted?: boolean };

function liveLines(bullets: readonly PickBullet[]): string[] {
  return bullets
    .map((b) => typeof b === "string" ? b : b.deleted ? "" : b.text)
    .filter((b) => b.trim().length > 0);
}

function termSet(lines: readonly string[]): Set<string> {
  return new Set(lines.flatMap(scopeTerms));
}

/** Jaccard overlap of two versions' scope terms (0 … 1). */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let both = 0;
  for (const t of a) if (b.has(t)) both++;
  return both / (a.size + b.size - both);
}

/**
 * REQ-446 (m13): which rewritten version the contractor's pick moves to when
 * the assistant rewrites the versions (REQ-392) — never simply the first:
 *  1. the version with the same role (concise / standard / detailed);
 *  2. else the one whose lines are closest to the picked card's (scope-term
 *     overlap; a tie keeps the same place);
 *  3. else the same place, else the first.
 * Nothing picked (or the write-it-myself tile) → the first version. Null only
 * when the rewrite has no versions.
 */
export function carryPickedOptionId(
  prev:
    | ReadonlyArray<
      { id: string; bullets: readonly PickBullet[]; style?: VersionStyle }
    >
    | null
    | undefined,
  prevSelectedId: string | null | undefined,
  next: ReadonlyArray<
    { id: string; bullets: readonly string[]; style?: VersionStyle }
  >,
): string | null {
  if (next.length === 0) return null;
  const first = next[0].id;
  if (!prevSelectedId) return first;
  const at = (prev ?? []).findIndex((o) => o.id === prevSelectedId);
  if (at < 0) {
    // the old list is gone: keep the same card id when the rewrite has it
    return next.find((o) => o.id === prevSelectedId) && !prev
      ? prevSelectedId
      : first;
  }
  const picked = prev![at];
  if (picked.style) {
    const same = next.find((o) => o.style === picked.style);
    if (same) return same.id;
  }
  const mine = termSet(liveLines(picked.bullets));
  let best = -1;
  let bestScore = 0;
  next.forEach((o, i) => {
    const score = overlap(mine, termSet(o.bullets));
    if (
      score > bestScore ||
      (score === bestScore && score > 0 && i === at)
    ) {
      best = i;
      bestScore = score;
    }
  });
  if (best >= 0) return next[best].id;
  return next[at]?.id ?? first;
}

/** A line's first letter lowered for joining — an acronym ("LED", "AC")
 *  keeps its case. */
function lowerFirst(s: string): string {
  return /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/**
 * REQ-400 (M21): the "· Short version" — EVERY item, in fewer lines (two to
 * a line). It used to be the first three lines, or every line but the last,
 * which is exactly a version holding part of the job.
 */
export function groupedBullets(bullets: readonly string[]): string[] {
  if (bullets.length <= 1) return bullets.slice();
  const out: string[] = [];
  for (let i = 0; i < bullets.length; i += 2) {
    const a = bullets[i].trim();
    const b = bullets[i + 1]?.trim();
    out.push(b ? `${a}; ${lowerFirst(b)}` : a);
  }
  return out;
}

// ── REQ-400 (demo-loop cycle 2, m32): a bullet is scope, never the customer ─
// Pair 2's lawn job got "Servicio para Ana López" and "Cliente: Ana López" as
// scope lines, and the first reached the sent agreement.

/** The customer the typed message names, and their contact. */
export interface CustomerFacts {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export function customerFactsFrom(raw: string): CustomerFacts {
  const text = raw ?? "";
  return {
    name: extractCustomerName(text),
    phone: extractPhone(text),
    email: extractEmail(text),
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A word in either case. The patterns below run WITHOUT the `i` flag —
 *  with it, \p{Lu} would match any letter and every word would be a name. */
function ci(word: string): string {
  return [...word].map((c) => {
    const lo = c.toLowerCase();
    const up = c.toUpperCase();
    if (/\s/.test(c)) return "\\s+";
    return lo === up ? escapeRe(c) : `[${lo}${up}]`;
  }).join("");
}

function anyOf(words: readonly string[]): string {
  return `(?:${words.map(ci).join("|")})`;
}

const SERVICE_WORDS = anyOf([
  "servicio",
  "service",
  "trabajo",
  "work",
  "job",
  "cotización",
  "cotizacion",
  "quote",
  "presupuesto",
  "estimate",
]);
const CONNECTORS = anyOf(["para", "for", "del", "de", "al", "a", "to"]);
const ARTICLES = anyOf(["los", "las", "la", "el", "the"]);
const HONORIFICS = `${
  anyOf([
    "familia",
    "family",
    "clienta",
    "cliente",
    "customer",
    "client",
    "señora",
    "senora",
    "señor",
    "senor",
    "srta",
    "sra",
    "sr",
    "mrs",
    "mr",
    "ms",
    "miss",
    "dr",
    "doña",
    "dona",
    "don",
  ])
}\\.?`;
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])";
/** "Customer: …", "Teléfono: …", "Duración: …" — a label, not a scope line.
 *  A hyphen counts only spaced ("Customer - Ana"): "Customer-supplied vanity"
 *  is scope. */
const LABEL_LINE = new RegExp(
  `^\\s*${
    anyOf([
      "customer name",
      "customer",
      "client",
      "clienta",
      "cliente",
      "homeowner",
      "owner",
      "propietaria",
      "propietario",
      "dueña",
      "dueño",
      "contacto",
      "contact",
      "nombre",
      "name",
      "teléfono",
      "telefono",
      "phone",
      "cell",
      "celular",
      "tel",
      "e-mail",
      "email",
      "correo",
      "dirección",
      "direccion",
      "domicilio",
      "address",
      "duración",
      "duracion",
      "duration",
      "timeline",
      "plazo",
      "tiempo estimado",
      "estimated time",
      "estimated duration",
      "fecha de inicio",
      "start date",
    ])
  }(?:\\s*[:：–—]|\\s+-)`,
  "u",
);
/** A capitalized name word — "Ana", "López", "McKay", "O'Brien"; never an
 *  acronym ("Service for HVAC" is scope). */
const NAME_WORD = "\\p{Lu}(?:['’]\\p{Lu})?\\p{Ll}[\\p{L}'’.-]*";
/** "Servicio para Ana", "Service for Dave Roof", "Cliente Ana López": a
 *  label naming a capitalized someone, nothing else. */
const NAME_LABEL_LINE = new RegExp(
  `^\\s*(?:(?:${SERVICE_WORDS}s?\\s+(?:${ci("para")}|${
    ci("for")
  })\\s+(?:${ARTICLES}\\s+)?(?:${HONORIFICS}\\s+)?)|(?:${
    anyOf(["clienta", "cliente", "customer", "client"])
  }\\s+))${NAME_WORD}(?:\\s+${NAME_WORD})*\\s*[.;:]?\\s*$`,
  "u",
);

const VOWEL_SETS: Record<string, string> = {
  a: "aáàäâ",
  e: "eéèëê",
  i: "iíìïî",
  o: "oóòöô",
  u: "uúùüû",
};

/** One letter of a name, accent-insensitive; a name word's first letter
 *  must be a capital (so "Kitchen remodel" is never the name "Kitchen
 *  Remodel"). */
function nameLetter(c: string, capital: boolean): string {
  const base = c.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  const vowels = VOWEL_SETS[base];
  if (vowels) {
    return `[${
      capital ? vowels.toUpperCase() : vowels + vowels.toUpperCase()
    }]`;
  }
  if (!/\p{L}/u.test(c)) return escapeRe(c);
  return capital
    ? escapeRe(c.toUpperCase())
    : `[${c.toLowerCase()}${c.toUpperCase()}]`;
}

function namePattern(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean)
    .map((w) => [...w].map((c, i) => nameLetter(c, i === 0)).join(""))
    .join("\\s+");
}

/** The customer's name with whatever introduces it ("servicio para la
 *  señora …", "for …", "Cliente …") — every way the name sits in a line. */
function nameRegex(name: string | null | undefined): RegExp | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  const forms = new Set([n]);
  const bare = n.replace(/^familia\s+/i, "").replace(/\s+family$/i, "");
  if (bare && bare !== n) forms.add(bare);
  const names = [...forms].map(namePattern).join("|");
  return new RegExp(
    `${NOT_WORD_BEFORE}(?:${SERVICE_WORDS}\\s+)?(?:${CONNECTORS}\\s+)?(?:${ARTICLES}\\s+)?(?:${HONORIFICS}\\s+)?(?:${names})${NOT_WORD_AFTER}`,
    "gu",
  );
}

const DUR_NUM =
  "(?:\\d{1,3}(?:[.,]\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce)";
const DUR_UNIT =
  "(?:hours?|hrs?|days?|weeks?|wks?|months?|mos?|horas?|dias?|semanas?|meses|mes)";
/** "Duración de 4 semanas", "4-week duration", "approximately 2 weeks",
 *  "2–3 días" — a time to complete and nothing else (matched on the
 *  lowercased, accent-free line). */
const DURATION_ONLY = new RegExp(
  `^(?:(?:duration|duracion|plazo|tiempo|timeline|estimated|estimado|estimada|approximately|approx|aprox|aproximadamente|about|around|roughly|thinking|for|por|during|durante|over|unos|unas|of|de|del|total|job|work|trabajo|the|el|la)\\s+)*${DUR_NUM}(?:\\s*(?:-|–|—|to|a)\\s*${DUR_NUM})?\\s*-?\\s*${DUR_UNIT}(?:\\s+(?:duration|de\\s+duracion|duracion|total|en\\s+total|in\\s+total|approx|approximately|aprox|aproximadamente|of\\s+work|de\\s+trabajo))?$`,
);

function isDurationOnly(text: string): boolean {
  const t = text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(/[.;:!?]+$/, "").replace(/\s+/g, " ").trim();
  return DURATION_ONLY.test(t);
}

/** Collapse what a removal leaves behind: doubled spaces, a space before
 *  punctuation, empty parentheses, dangling separators at either end. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,;:.!?)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.\-–—/]+/, "")
    .replace(/[\s,;:\-–—/]+$/, "")
    .trim();
}

/** Comma-separated parts of a line ("…, 4 semanas") — a decimal or
 *  thousands comma ("1,200") is not a separator. */
function dropDurationParts(text: string): string {
  const parts = text.split(/\s*,\s+/);
  if (parts.length < 2) return text;
  const kept = parts.filter((p) => !isDurationOnly(p));
  return kept.length === parts.length || kept.length === 0
    ? text
    : kept.join(", ");
}

function removeName(text: string, facts: CustomerFacts): string {
  const re = nameRegex(facts.name);
  return re ? text.replace(re, " ") : text;
}

/**
 * REQ-400 (m32): a MODEL bullet as a scope line, or null when it is not one:
 * a customer / contact / duration label ("Cliente: Ana López", "Duration: 3
 * days"), a line carrying a phone or an e-mail, "Servicio para <Name>", the
 * customer's name alone, a duration on its own ("Duración de 4 semanas").
 * A scope line that also names the customer keeps the scope ("Weekly lawn
 * mowing for Ana López" → "Weekly lawn mowing").
 */
export function cleanScopeBullet(
  bullet: string,
  facts: CustomerFacts = {},
): string | null {
  const text = (bullet ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (extractEmail(text) || extractPhone(text)) return null;
  if (LABEL_LINE.test(text) || NAME_LABEL_LINE.test(text)) return null;
  if (isDurationOnly(text)) return null;
  const stripped = tidy(dropDurationParts(removeName(text, facts)));
  return scopeTerms(stripped).length > 0 ? stripped : null;
}

/**
 * REQ-400 (m32): a line derived from the TYPED message (the honest fallback,
 * REQ-026) keeps its scope and loses the customer: their name with what
 * introduces it, their phone and e-mail, a ", 4 semanas" part. Null when
 * nothing scope-like is left.
 */
export function stripCustomerDetails(
  line: string,
  facts: CustomerFacts = {},
): string | null {
  let text = (line ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 8; i++) {
    const hit = extractEmail(text) ?? extractPhone(text);
    if (!hit) break;
    text = text.replace(hit, " ");
  }
  if (isDurationOnly(text)) return null;
  text = tidy(dropDurationParts(tidy(removeName(text, facts))));
  if (scopeTerms(text).length === 0) return null;
  return text;
}
