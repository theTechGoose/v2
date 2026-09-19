/**
 * REQ-017 — NW-08 / NW-09 / NW-12 over the REAL API.
 *
 * POST /agents/job-details/prices must answer with the three client-defined
 * tiers (competitive / market / premium), fixed labels, and the materials
 * basis — whatever the model (or the stub's fallback) returns.
 */
import { type ApiSession, contractor } from "./helpers/api";

const PHONE = "+15125550960";

describe("REQ-017 suggest-prices — tiers, labels, basis over HTTP", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor(PHONE);
    await s.put("/me", { language: "en", name: "Pricing Contractor" });
    const addr = await s.put("/profile/address", { city: "Austin", state: "TX", postal: "78701" });
    expect(addr.status).toBeLessThan(400);
  });

  it("REQ-017 returns competitive / market / premium with fixed labels and basis=labor_and_materials", async () => {
    const r = await s.post("/agents/job-details/prices", {
      raw: "Paint 2000 sq ft interior, two coats, baseboards and crown, 12 door jambs, 15 windows, all ceilings",
    });
    expect(r.status).toBe(200);
    const options = r.body?.options as Array<{ tier: string; label: string; priceCents: number; rationale: string }>;
    expect(options.map((o) => o.tier)).toEqual(["competitive", "market", "premium"]);
    expect(options.map((o) => o.label)).toEqual(["Competitive", "Market", "Premium"]);
    expect(options.every((o) => Number.isInteger(o.priceCents) && o.priceCents > 0)).toBe(true);
    expect(options[0].priceCents).toBeLessThan(options[1].priceCents);
    expect(options[1].priceCents).toBeLessThan(options[2].priceCents);
    expect(r.body?.basis).toBe("labor_and_materials");
  }, 60_000);
});
