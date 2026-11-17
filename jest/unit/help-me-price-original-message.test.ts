/**
 * REQ-260 — demo issue M24: "Suggested prices far too low for a full bathroom
 * gut ($1,450 / $1,750 / $2,100)".
 *
 * Root cause (demo-rca.md M24): in "help me price it" the confirm picker's
 * Continue (AsstChat.tsx applyJobOption, confirm branch) priced
 * `description || summary` — the 3–4 terse confirmed bullets, prices dropped —
 * so /agents/job-details/prices never saw the contractor's own message (the
 * $2,800 plumbing sub, the slab cut, the 72" vanity). The browser's half of
 * the fix: the client posts BOTH the original message (`raw`) and the
 * confirmed bullets (`scope`), and the confirm branch hands it the message the
 * contractor typed.
 */
import * as fs from "fs";
import * as path from "path";
import { assistantClient } from "../../front-end/clients/assistant";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-260 M24 — pricing sees the contractor's original message", () => {
  const g = globalThis as { fetch?: unknown };
  const realFetch = g.fetch;
  afterEach(() => {
    g.fetch = realFetch;
  });

  test("REQ-260 assistantClient.suggestPrices posts {raw, scope} — the typed message and the confirmed bullets", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    g.fetch = async (url: string, init: { body?: string }) => {
      seen.push({
        url: String(url),
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return new Response(
        JSON.stringify({ options: [], basis: "labor_and_materials" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const raw =
      "Full gut of the hall bath — my plumber quoted $2,800 for rough-in.";
    const scope =
      "Demolish bathroom to studs\nReroute drain for curbless shower";
    await (assistantClient.suggestPrices as (
      r: string,
      s?: string,
    ) => Promise<unknown>)(raw, scope);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/\/agents\/job-details\/prices$/);
    expect(seen[0].body).toEqual({ raw, scope });
  });

  test("REQ-260 the confirm branch prices the TYPED message with the confirmed bullets as scope, not the bullets alone", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const start = src.indexOf('if (pickerMode === "confirm") {');
    expect(start).toBeGreaterThan(0);
    const branch = src.slice(start, src.indexOf("return;", start));
    // The bullets-only call is the bug.
    expect(branch).not.toMatch(
      /fetchPriceSuggestions\(description \|\| summary\)/,
    );
    // The original typed message (still in pendingJobDetailsRaw until this
    // branch overwrites it) is captured BEFORE the overwrite and priced.
    const call = branch.match(/fetchPriceSuggestions\(([^;]*)\);/);
    expect(call).not.toBeNull();
    expect(call![1]).toMatch(/typed/i);
    expect(call![1]).toMatch(/description \|\| summary/);
    const typedAt = branch.search(/const typed\w* = [^;]*pendingJobDetailsRaw/);
    const overwriteAt = branch.indexOf("setPendingJobDetailsRaw(");
    expect(typedAt).toBeGreaterThanOrEqual(0);
    expect(typedAt).toBeLessThan(overwriteAt);
  });
});
