/**
 * REQ-332 — demo cycle 1, issue m30: "'Professionalize' changes the meaning
 * (permit scope; 'Prices include materials' though client buys vanity)".
 *
 * The browser's half: the Job Details picker sends the job (original message
 * + sibling bullets) with the bullet it professionalizes and applies a
 * multi-line answer as several bullets; the pricing screen shows the basis
 * the server derived, not a fixed "labor and materials" label.
 */
import * as fs from "fs";
import * as path from "path";
import { assistantClient } from "../../front-end/clients/assistant";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-332 m30 — professionalize keeps the scope, the basis follows the job", () => {
  const g = globalThis as { fetch?: unknown };
  const realFetch = g.fetch;
  afterEach(() => {
    g.fetch = realFetch;
  });

  test("REQ-332 assistantClient.professionalizeBullet posts the bullet WITH its job context", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    g.fetch = async (url: string, init: { body?: string }) => {
      seen.push({
        url: String(url),
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return new Response(
        JSON.stringify({
          text: "Install 4 recessed lights",
          lines: ["Install 4 recessed lights", "City of Austin permit"],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const context = {
      raw: "4 recesed lights + City of Austin permit, repaint ceiling",
      siblings: ["Repaint ceiling"],
    };
    const res = await (assistantClient.professionalizeBullet as (
      t: string,
      c?: unknown,
    ) => Promise<{ text: string; lines?: string[] }>)(
      "4 recesed lights + City of Austin permit",
      context,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/\/agents\/job-details\/professionalize$/);
    expect(seen[0].body).toEqual({
      text: "4 recesed lights + City of Austin permit",
      context,
    });
    expect(res.lines).toEqual([
      "Install 4 recessed lights",
      "City of Austin permit",
    ]);
  });

  test("REQ-332 the picker sends the original message + sibling bullets and applies a multi-line answer as several bullets", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const start = src.indexOf("async function confirmProfessionalize()");
    expect(start).toBeGreaterThan(0);
    const fn = src.slice(
      start,
      src.indexOf("function dismissProfessionalize", start),
    );
    expect(fn).toMatch(
      /professionalizeBullet\(b\.text,\s*\{[^}]*raw[^}]*siblings[^}]*\}\)/s,
    );
    expect(fn).toMatch(/res\??\.lines/);
    expect(fn).toMatch(/replaceBulletWithLines\(/);
  });

  test("REQ-332 the pricing screen renders the basis the server answered, not a fixed label", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const basis = src.slice(
      src.indexOf('data-cy="pricing-basis"'),
      src.indexOf("</div>", src.indexOf('data-cy="pricing-basis"')),
    );
    expect(basis).not.toContain(
      'tFor(lang, "suggestPrices.basis.laborAndMaterials")',
    );
    expect(basis).toMatch(/priceBasis/);
    const fetchFn = src.slice(
      src.indexOf("async function fetchPriceSuggestions"),
      src.indexOf("function teardownRecording"),
    );
    expect(fetchFn).toMatch(/setPriceBasis\(res\.basis/);
  });

  test("REQ-332 both dictionaries carry the 'labor; materials as noted' basis line", () => {
    expect(en["suggestPrices.basis.laborMaterialsAsNoted"]).toBe(
      "Prices include labor; materials as noted in the job details",
    );
    expect(es["suggestPrices.basis.laborMaterialsAsNoted"]).toBe(
      "Los precios incluyen mano de obra; los materiales según se indica en los detalles del trabajo",
    );
    expect(en["suggestPrices.basis.laborAndMaterials"]).toBe(
      "Prices include labor and materials",
    );
  });

  test("REQ-332 the professionalize prompt forbids merging / re-scoping and asks for 'A + B' as separate lines (both dictionaries, English)", () => {
    for (const d of [en, es]) {
      const p = d["prompts.professionalizeBullet"];
      expect(p).toMatch(/do not merge/i);
      expect(p).toMatch(/re-?scope/i);
      expect(p).toMatch(/separate lines/i);
      expect(p).toContain('"lines"');
    }
  });
});
