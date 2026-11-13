/**
 * REQ-266 (demo issue ai-assistant-p7-options): job options must not drop
 * scope items. A ten-item gut job lost hex mosaic, faucets, fan and lights
 * because every options path capped an option at 4 bullets — the backend
 * normalizer, its heuristic fallback, and the island's own last-resort
 * fallback (AsstChat.tsx localFallbackOptions). One shared rule now owns the
 * cap.
 *
 * REQ-722 (demo-loop cycle 5, p18-3b): the "wider scope" variant appended a
 * fixed "Jobsite cleanup" line — invented scope, and construction wording for
 * a house clean. No path pads with it any more.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as optionBullets from "../../shared/quote-flow/option-bullets";

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
  it("REQ-266 (amended by REQ-330) there is no cap at all: the island's fallback keeps every line", () => {
    const src = readFileSync(
      resolve(__dirname, "../../front-end/islands/AsstChat.tsx"),
      "utf8",
    );
    const start = src.indexOf("function localFallbackOptions(");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).not.toMatch(/scoped\.bullets\.slice\(/);
  });

  it("REQ-722 (cycle 5, p18-3b) no shared helper pads a version with a fixed cleanup line", () => {
    expect("widerBullets" in optionBullets).toBe(false);
    // The grouped (short) version is the only padding: every item, no new one.
    expect(optionBullets.groupedBullets(ITEMS).join(" ")).not.toMatch(
      /jobsite|cleanup/i,
    );
  });

  it("REQ-722 (cycle 5, p18-3b) no options path appends 'Jobsite cleanup', and the dead keys are gone in en and es", () => {
    const root = resolve(__dirname, "../..");
    const island = readFileSync(
      resolve(root, "front-end/islands/AsstChat.tsx"),
      "utf8",
    );
    const start = island.indexOf("function localFallbackOptions(");
    const body = island.slice(start, island.indexOf("\n}\n", start));
    expect(body).not.toMatch(/jobsiteCleanup|widerBullets/);
    const coord = readFileSync(
      resolve(
        root,
        "backend/src/agents/domain/coordinators/generate-job-options/mod.ts",
      ),
      "utf8",
    );
    expect(coord).not.toMatch(/jobsiteCleanup|widerBullets\(/);
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(
        readFileSync(resolve(root, `lang/${lang}.json`), "utf8"),
      );
      expect(dict["asstChat.jobsiteCleanup"]).toBeUndefined();
      expect(dict["generateJobOptions.jobsiteCleanup"]).toBeUndefined();
    }
  });

  it("REQ-266 the island's last-resort fallback uses the shared cap, never slice(0, 4)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../front-end/islands/AsstChat.tsx"),
      "utf8",
    );
    const start = src.indexOf("function localFallbackOptions(");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).not.toMatch(/\.slice\(0, 4\)/);
    expect(body).not.toMatch(/MAX_OPTION_BULLETS/); // REQ-330: no cap
    expect(body).toMatch(/groupedBullets\(/);
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
