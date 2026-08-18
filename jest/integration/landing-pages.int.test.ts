/**
 * RED (TDD) — SSR consistency between the two landing pages, real HTTP.
 *
 * P-08 "Two landing pages selling contradictory offers. /landing: 'Prueba GRATIS
 *       por 30 días', 'Papeleo ilimitado' as the $99 differentiator. /: no trial
 *       anywhere, 'desde $15', unlimited included at $15. '+1.200 contratistas'
 *       vs '34 contractors signed up this week' (hardcoded English)."
 * P-19 "Root hero showcase stays English in Spanish mode + EN-first SSR flash …
 *       SSR is fully English with a Spanish title, flipping after hydration."
 *
 * PROPOSED ADMIN CONTRACT (P-08 <<solution>> — "add a section in super admin to
 * configure landing offers"). Pinned minimally here:
 *
 *   GET /api/admin/landing-offers   (authed session)
 *   → 200 {
 *       trialDays: number,
 *       priceFromCents: number,
 *       unlimitedTier: string,
 *       socialProof: { contractors: number, docsSent: number },
 *     }
 *
 *   Red today: 404 (no such route). Both landing pages must render their offer
 *   claims from this single config (see jest/unit/landing-copy.test.ts for the
 *   shared/quote-flow/landing-offers.ts module half).
 *
 * Live-HTML probes grounding these assertions (2026-08-18, pm_lang=es):
 *   /         → "<html>" (no lang attr), EN body ("You communicate with us in
 *               Spanish", hs-doc__tag>Quote, "Signed ✓", "Online • SMS",
 *               "Unlimited quotes & agreements" under $15, "1,200+ contractors",
 *               "34 contractors … signed up this week"), NO trial claim.
 *   /landing  → Spanish body: "Prueba Paperwork Monster GRATIS por 30 días",
 *               "30 días gratis", "Papeleo ilimitado" as the $99 Pro blurb.
 */
import { contractor } from "./helpers/api";

const FE = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";

async function pageHtml(path: string, lang = "es"): Promise<string> {
  const res = await fetch(`${FE}${path}`, {
    headers: { cookie: `pm_lang=${lang}` },
    redirect: "manual",
  });
  expect(res.status).toBe(200);
  return await res.text();
}

// Trial claims only — deliberately does NOT match "ad-free Netflix" / "frees up".
const TRIAL_RE =
  /free trial|free for 30|30 days free|prueba gratis|gratis por 30|30 días gratis/i;

/**
 * Which priced tier(s) carry the "unlimited" pitch: for every
 * unlimited/ilimitado occurrence, attribute it to the nearest PRECEDING
 * tier price ($15/$99/$199). Occurrences before any price (e.g. the
 * /landing trial card) are ignored.
 */
function unlimitedTiers(html: string): number[] {
  const tiers = new Set<number>();
  const re = /unlimited|ilimitad/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const before = html.slice(0, m.index);
    const prices = [...before.matchAll(/\$\s?(15|99|199)\b/g)];
    if (prices.length) tiers.add(Number(prices[prices.length - 1][1]));
  }
  return [...tiers].sort((a, b) => a - b);
}

describe("P-08 the two landing pages sell ONE offer", () => {
  let root = "";
  let landing = "";

  beforeAll(async () => {
    root = await pageHtml("/");
    landing = await pageHtml("/landing");
  });

  it("P-08 both pages make the same free-trial claim (both or neither)", () => {
    // Red today: / has no trial anywhere; /landing headlines
    // "Prueba Paperwork Monster GRATIS por 30 días" + "30 días gratis".
    expect({ rootHasTrial: TRIAL_RE.test(root) }).toEqual({
      rootHasTrial: TRIAL_RE.test(landing),
    });
  });

  it('P-08 the "unlimited" pitch belongs to the SAME priced tier on both pages', () => {
    // Red today: / includes "Unlimited quotes & agreements" in the $15 Starter,
    // /landing sells "Papeleo ilimitado…" as the $99 Pro differentiator.
    expect(unlimitedTiers(root)).toEqual(unlimitedTiers(landing));
  });

  it("P-08 the Spanish page carries no English social-proof counters", () => {
    // Red today: routes/index.tsx:1020 hardcodes
    // "<strong>34 contractors</strong> signed up this week" (no data-i18n), and
    // the EN "1,200+ contractors" is what SSR emits even with pm_lang=es.
    expect(root).not.toContain("signed up this week");
    expect(root).not.toContain("1,200+ contractors");
  });
});

describe("P-19 / SSR is already Spanish when pm_lang=es (no wrong-language first paint)", () => {
  let html = "";

  beforeAll(async () => {
    html = await pageHtml("/", "es");
  });

  it('P-19 the document declares <html lang="es">', () => {
    // Red today: SSR emits a bare "<html>".
    expect(html).toMatch(/<html[^>]*\blang="es"/);
  });

  it("P-19 hero copy is server-rendered in Spanish, not EN-with-a-Spanish-title", () => {
    // Red today: the <title> is Spanish but the body says
    // "You communicate with us in Spanish…" (hero.lead EN).
    expect(html).toContain("Nos escribes en español");
    expect(html).not.toContain("You communicate with us in Spanish");
  });

  it('P-19 hero showcase is Spanish: the orphaned doc.q.tag "Cotización" finally applies', () => {
    // Red today: <span class="hs-doc__tag">Quote</span> plus hardcoded
    // "Signed ✓" and "Online • SMS" (routes/index.tsx:333-406) — the ES dict's
    // doc.q.tag: "Cotización" never reaches this markup.
    // ("Cotización" alone appears in island-props JSON, so the assertion is
    // anchored to the hs-doc__tag element.)
    expect(html).toMatch(/hs-doc__tag[^>]*>\s*Cotización/);
    expect(html).not.toMatch(/hs-doc__tag[^>]*>\s*Quote\b/);
    expect(html).not.toContain("Signed ✓");
    expect(html).not.toContain("Online • SMS");
  });
});

describe("P-08 admin-configurable landing offers (PROPOSED CONTRACT — see header)", () => {
  it("P-08 authed GET /admin/landing-offers returns the single offer config (red today: 404)", async () => {
    const s = await contractor("+15125552900");
    const { status, body } = await s.get("/admin/landing-offers");
    expect(status).toBe(200);
    expect(Number.isInteger(body?.trialDays)).toBe(true);
    expect(body?.priceFromCents).toBeGreaterThan(0);
    expect(typeof body?.unlimitedTier).toBe("string");
    expect(Number.isInteger(body?.socialProof?.contractors)).toBe(true);
    expect(Number.isInteger(body?.socialProof?.docsSent)).toBe(true);
  });
});
