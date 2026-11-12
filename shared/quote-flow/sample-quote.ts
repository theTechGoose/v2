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
 */

export const SAMPLE_TRADES = [
  "plumbing",
  "electrical",
  "roofing",
  "painting",
  "hvac",
  "cleaning",
  "landscaping",
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
  ["cleaning", ["clean", "limpi", "maid", "janitor", "pressure wash"]],
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
    "concrete",
    "concreto",
    "masonry",
    "pasto",
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
