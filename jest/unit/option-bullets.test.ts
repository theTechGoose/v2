/**
 * REQ-266 (demo issue ai-assistant-p7-options): job options must not drop
 * scope items. A ten-item gut job lost hex mosaic, faucets, fan and lights
 * because every options path capped an option at 4 bullets — the backend
 * normalizer, its heuristic fallback, and the island's own last-resort
 * fallback (AsstChat.tsx localFallbackOptions). One shared rule now owns the
 * cap and the "wider scope" variant.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_OPTION_BULLETS,
  widerBullets,
} from "../../shared/quote-flow/option-bullets";

const ITEMS = [
  "Gutted old fixtures and tile",
  "Curbless shower",
  "Slab cut for linear drain",
  "Frameless glass enclosure",
  "72 inch double vanity",
  "Hex mosaic shower floor",
  "Two widespread faucets",
  "Exhaust fan",
  "Recessed lights",
  "Pull the permit",
];

describe("REQ-266 ai-assistant-p7-options option bullets", () => {
  it("REQ-266 the cap holds a ten-item job whole", () => {
    expect(MAX_OPTION_BULLETS).toBeGreaterThanOrEqual(10);
  });

  it("REQ-266 the wider version is every item plus jobsite cleanup", () => {
    expect(widerBullets(ITEMS, "Jobsite cleanup")).toEqual([
      ...ITEMS,
      "Jobsite cleanup",
    ]);
    expect(widerBullets(["A", "Jobsite cleanup"], "Jobsite cleanup")).toEqual([
      "A",
      "Jobsite cleanup",
    ]);
  });

  it("REQ-266 the island's last-resort fallback uses the shared cap, never slice(0, 4)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../front-end/islands/AsstChat.tsx"),
      "utf8",
    );
    const start = src.indexOf("function localFallbackOptions(");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).not.toMatch(/\.slice\(0, 4\)/);
    expect(body).toMatch(/MAX_OPTION_BULLETS/);
    expect(body).toMatch(/widerBullets\(/);
  });

  it("REQ-266 the backend options coordinator uses the shared rule", () => {
    const src = readFileSync(
      resolve(
        __dirname,
        "../../backend/src/agents/domain/coordinators/generate-job-options/mod.ts",
      ),
      "utf8",
    );
    expect(src).toMatch(/#quote-flow\/option-bullets\.ts/);
    expect(src).not.toMatch(/\.slice\(0, 4\)/);
  });
});
