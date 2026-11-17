/**
 * REQ-613 (demo-loop cycle 4, issue M31) — a replaced logo reaches every customer document at
 * once.
 *
 * The demo replaced the business logo (orange → blue) after the quote was sent. Reloading the
 * quote still showed the orange logo for up to five minutes: the page drew
 * `/api/public-logo/quote/<id>` — a URL that never changes — and the route served it with
 * `cache-control: public, max-age=300`, so the browser reused its copy without asking. The
 * invoice issued later (a URL the browser had never fetched) showed blue.
 *
 * The fix puts the logo's version in the URL. This unit pins the shared rule
 * (shared/quote-flow/public-logo-url.ts) and the public pages' wiring.
 */
import * as fs from "fs";
import * as path from "path";
import {
  logoVersion,
  publicLogoUrl,
} from "../../shared/quote-flow/public-logo-url";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("REQ-613 (cycle 4, M31) the public logo URL carries the logo's version", () => {
  test("logoVersion: stable for one file, different for another, and never the file id itself", () => {
    const a = logoVersion("0193a3c2-orange-logo");
    expect(a).toBe(logoVersion("0193a3c2-orange-logo"));
    expect(a).not.toBe(logoVersion("0193a3c2-blue-logo"));
    expect(a).toMatch(/^[0-9a-z]{4,16}$/);
    expect(a).not.toContain("orange");
  });

  test("publicLogoUrl: the version rides as ?v=, and a replaced logo yields a new URL", () => {
    const orange = publicLogoUrl("quote", "q-1", logoVersion("f-orange"));
    const blue = publicLogoUrl("quote", "q-1", logoVersion("f-blue"));
    expect(orange).toBe(
      `/api/public-logo/quote/q-1?v=${logoVersion("f-orange")}`,
    );
    expect(blue).not.toBe(orange);
    expect(publicLogoUrl("invoice", "inv-1", "abc")).toBe(
      "/api/public-logo/invoice/inv-1?v=abc",
    );
    // an older projection with no version still gets a working (revalidated) URL
    expect(publicLogoUrl("quote", "q-1", undefined)).toBe(
      "/api/public-logo/quote/q-1",
    );
    // a base URL for emails
    expect(publicLogoUrl("invoice", "inv-1", "abc", "https://documonster.com"))
      .toBe(
        "https://documonster.com/api/public-logo/invoice/inv-1?v=abc",
      );
  });

  test("the public quote and invoice pages draw the logo through the versioned URL", () => {
    const quoteDoc = read("front-end/components/quote-doc.tsx");
    expect(quoteDoc).toMatch(
      /publicLogoUrl\(\s*"quote",\s*quote\.id,\s*contractor\.logoVersion/,
    );
    expect(quoteDoc).not.toContain("src={`/api/public-logo/");
    const invoicePage = read("front-end/routes/i/[id].tsx");
    expect(invoicePage).toMatch(
      /publicLogoUrl\(\s*"invoice",\s*invoice\.id,\s*invoice\.contractor\.logoVersion/,
    );
    expect(invoicePage).not.toContain("src={`/api/public-logo/");
  });
});
