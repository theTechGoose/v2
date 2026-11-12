/**
 * REQ-438 (demo-loop cycle 3, M7) — the language a contractor TYPED one
 * message in. Pair 6's app was in English and they wrote Spanish; every
 * reply came back in English, because the coordinator only read the app
 * language (user.language). The coordinator now answers in the message's
 * language and falls back to the app language when this can't tell.
 *
 * A count of function words (and lower-case accented words) on each side.
 * Capitalised words are skipped unless they are function words, so a Spanish
 * NAME in an English sentence ("Quote for María José Peña") stays English.
 *
 * REQ-579 (cycle 4, M14): shared, so the quick quote names its job in the
 * language it was typed (front-end) by the same rule the chat replies use.
 */

const ES_WORDS = new Set(
  (
    "el la los las un una unos unas de del al para por que qué es son " +
    "está están esta este esto ese esa eso con sin y mi mis tu su sus " +
    "se lo le les nos pero como cómo cuánto cuánta cuándo dónde cuál " +
    "también muy más ya todo toda todos hay en quiero quiere necesito " +
    "necesita borra elimina agrega añade cambia cambiar pon haz manda " +
    "cotización cotizacion factura facturas trabajo cliente clienta " +
    "nueva nuevo solo sólo favor gracias debe deben incluido hola bueno " +
    "sí"
  ).split(" "),
);

const EN_WORDS = new Set(
  (
    "the an and for to of is are was be my our your his her their with " +
    "please it this that these what how much many does do did can could " +
    "would should will you i we he she they him them add delete remove " +
    "void invoice quote job wants want needs need also too so out at in " +
    "on from all just make send replace comes owe owes yes thanks by " +
    "not isn't it's don't there here about after before up new"
  ).split(" "),
);

const ACCENTED = /[áéíóúñü]/;

/** "es" / "en" when one side clearly wins (two signals or more); undefined
 *  when the message is too short or too mixed to tell. */
export function messageLang(text: string): "es" | "en" | undefined {
  const s = (text ?? "").trim();
  if (!s) return undefined;
  let es = /[¿¡]/.test(s) ? 1 : 0;
  let en = 0;
  for (const m of s.matchAll(/[\p{L}'’]+/gu)) {
    const raw = m[0];
    const w = raw.toLowerCase().replace(/’/g, "'");
    if (ES_WORDS.has(w)) es++;
    else if (EN_WORDS.has(w)) en++;
    else if (ACCENTED.test(w) && raw[0] === raw[0].toLowerCase()) es++;
  }
  if (es >= 2 && es > en) return "es";
  if (en >= 2 && en > es) return "en";
  return undefined;
}
