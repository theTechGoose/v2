/**
 * The ONE Spanish trade glossary every model path that writes Spanish job copy
 * carries: the picker's options (GenerateJobOptions), the chat model's
 * update_job_details rewrite (its `es` field + the Ready-to-send review hint),
 * the polished job details (PolishJobDetails) and the translation of edited
 * bullets (TranslateBullets).
 *
 * REQ-350 (demo-loop cycle 1, m9): "Customer supplied vanity installation"
 * came back as "Instalación de lavabo …" — a lavabo is the sink.
 * REQ-448 (demo-loop cycle 3, m47): the demo's Spanish read "trinchado"
 * (trench), "un corte para la cocina" (cooktop cutout), "gabinetes de shaker"
 * and left "sq ft" untranslated — only TranslateBullets had a glossary, and it
 * had none of these.
 * REQ-594 (demo-loop cycle 4, m40): "sink / basin → lavabo" turned a kitchen
 * sink into a bathroom basin, and "soffit" stayed in English — a kitchen sink
 * is a fregadero, only a bathroom sink is a lavabo, and soffit has an entry.
 */
export const ES_TRADE_GLOSSARY =
  "Spanish trade glossary (whenever you write Spanish, use these terms): " +
  "vanity → mueble de baño (or tocador), never lavabo; " +
  "kitchen sink → fregadero (or tarja), never lavabo; " +
  "bathroom sink / basin → lavabo; " +
  'soffit → plafón del alero (or sofito), never left as "soffit"; ' +
  "countertop → encimera; backsplash → salpicadero; " +
  "drywall → tablaroca; studs → montantes; trim → molduras; grout → lechada; " +
  "trench → zanja, never trinchado; " +
  "cooktop cutout → corte para la estufa, never corte para la cocina; " +
  "shaker cabinets → gabinetes estilo shaker, never gabinetes de shaker; " +
  "sq ft / sf → pies cuadrados and lf / linear ft → pies lineales, spelled out " +
  "(e.g. 120 pies cuadrados, 40 pies lineales) — never leave sq ft, sf or lf in Spanish text.";
