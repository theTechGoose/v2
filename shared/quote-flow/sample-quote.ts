/**
 * REQ-256 — the onboarding "see what your customer sees" sample quote.
 *
 * Demo issue onboarding-dashboard-settings-p2: every account got the same
 * "Paver Patio Installation" sample, whatever the business did, written once in
 * the language the account had at signup. Onboarding asks no trade question,
 * so the sample's job comes from the one thing the wizard does know by then:
 * the business name ("Rivera Plumbing" → a plumbing job). A name that names no
 * trade gets a general home-repair job, never a paver patio.
 *
 * The copy itself lives in lang/{en,es}.json under
 * `ensureSampleQuote.<trade>.{jobName,materials,labor}`; the sample stores
 * BOTH languages so the public page's EN | ES toggle flips the content too,
 * not only the page chrome.
 *
 * REQ-360 (demo-loop cycle 1, m11): a junk-removal business got the general
 * "Home Repair Visit". The table now also knows junk removal, moving, pest
 * control, fencing, concrete and handyman work. Specific trades are checked
 * before broad ones (junk before cleaning, so "clean-out" hauls junk;
 * handyman last, so "Rivera Plumbing & Handyman" stays a plumber).
 */

export const SAMPLE_TRADES = [
  "plumbing",
  "electrical",
  "roofing",
  "painting",
  "hvac",
  "cleaning",
  "landscaping",
  "junk",
  "moving",
  "pest",
  "fencing",
  "concrete",
  "handyman",
  "general",
] as const;
export type SampleTrade = (typeof SAMPLE_TRADES)[number];

/** Lower-case word stems, English and Spanish, that name a trade. Checked in
 *  this order — the first trade with a hit wins. */
const KEYWORDS: ReadonlyArray<readonly [SampleTrade, readonly string[]]> = [
  ["plumbing", [
    "plumb",
    "plomer",
    "rooter",
    "drain",
    "pipe",
    "tuber",
    "fontaner",
  ]],
  ["electrical", ["electric", "eléctric", "electri", "wiring", "electrician"]],
  ["roofing", ["roof", "techo", "techad", "teja"]],
  ["painting", ["paint", "pintur", "pintor"]],
  ["hvac", [
    "hvac",
    "heating",
    "cooling",
    "air condition",
    "a/c",
    "aire acondicionado",
    "climatiz",
    "refrigera",
    "furnace",
  ]],
  ["pest", [
    "pest",
    "termit",
    "extermin",
    "bug",
    "rodent",
    "mosquito",
    "plaga",
    "fumig",
    "control de plagas",
  ]],
  ["junk", [
    "junk",
    "haul",
    "debris",
    "dumpster",
    "trash",
    "clean-out",
    "cleanout",
    "clean out",
    "basura",
    "escombro",
    "chatarra",
    "acarreo",
  ]],
  ["moving", ["moving", "movers", "mudanza", "relocat"]],
  ["cleaning", ["clean", "limpi", "maid", "janitor", "pressure wash"]],
  ["fencing", ["fence", "fencing", "cercas", "cercad", "vallas", "vallad"]],
  ["concrete", [
    "concrete",
    "concreto",
    "cement",
    "masonry",
    "hormig",
    "albañil",
    "driveway",
  ]],
  ["landscaping", [
    "landscap",
    "lawn",
    "paver",
    "patio",
    "hardscap",
    "garden",
    "jardin",
    "jardín",
    "yard",
    "tree",
    "pasto",
  ]],
  ["handyman", [
    "handyman",
    "handy man",
    "handyperson",
    "fix-it",
    "fix it",
    "odd job",
    "manitas",
    "chambitas",
    "reparaciones",
  ]],
];

/** The trade a business name points at; "general" when it names none. */
export function inferSampleTrade(businessName?: string | null): SampleTrade {
  const name = (businessName ?? "").toLowerCase();
  if (!name.trim()) return "general";
  for (const [trade, stems] of KEYWORDS) {
    if (stems.some((s) => name.includes(s))) return trade;
  }
  return "general";
}

/** Per-trade prices in INTEGER cents: [materials, labor]. Small, believable,
 *  easy to scan in five seconds. */
export const SAMPLE_PRICES: Record<SampleTrade, readonly [number, number]> = {
  plumbing: [350_00, 600_00],
  electrical: [400_00, 750_00],
  roofing: [4_800_00, 3_200_00],
  painting: [600_00, 1_800_00],
  hvac: [3_200_00, 1_600_00],
  cleaning: [60_00, 240_00],
  landscaping: [2_200_00, 1_500_00],
  junk: [150_00, 350_00],
  moving: [120_00, 780_00],
  pest: [90_00, 160_00],
  fencing: [1_800_00, 1_400_00],
  concrete: [2_100_00, 1_900_00],
  handyman: [120_00, 360_00],
  general: [250_00, 450_00],
};

/** The dictionary keys a trade's sample reads. */
export function sampleQuoteKeys(trade: SampleTrade) {
  return {
    jobName: `ensureSampleQuote.${trade}.jobName`,
    materials: `ensureSampleQuote.${trade}.materials`,
    labor: `ensureSampleQuote.${trade}.labor`,
  } as const;
}
