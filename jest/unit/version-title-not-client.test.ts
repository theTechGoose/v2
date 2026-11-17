/**
 * REQ-759 (demo-loop cycle 5v2, m49 re-open) — the internal version label
 * never reaches the client.
 *
 * Verifier: the picker offered "Terraza de madera [Breve]" and "Terraza de
 * madera · Versión breve [Detallada]"; picking the second, the customer page
 * read "Terraza de madera · versión breve". The server's titles are pinned
 * in backend generate-job-options/version-qualifier.int.test.ts; this file
 * pins the island's own offline fallback (localFallbackOptions), which
 * titled its second card with versionTitle(…, "short") the same way.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SRC = readFileSync(
  resolve(ROOT, "front-end/islands/AsstChat.tsx"),
  "utf8",
);

function fnBody(name: string): string {
  const start = SRC.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("\n}\n", start);
  return SRC.slice(start, end);
}

describe("REQ-759 (cycle 5v2, m49) the offline fallback's cards keep the job's title", () => {
  it("never titles a card with a version qualifier (versionTitle)", () => {
    const body = fnBody("localFallbackOptions");
    expect(body).not.toMatch(/versionTitle\(/);
    expect(body).not.toMatch(/Versi[oó]n breve|Short version/i);
  });

  it("tells the cards apart by their style label instead (labelVersionStyles)", () => {
    const body = fnBody("localFallbackOptions");
    expect(body).toMatch(/labelVersionStyles\(/);
  });
});
