/**
 * REQ-467 (demo-loop cycle 3, issue p8-pair5-a) — the open-quote panel's
 * pill said "Sent" after Version 2 was published while the document line
 * under it (shared quoteState) said "Revised". The pill came from a private
 * badgeStatusFor in QuotesPage.tsx that never read the version. Both words
 * now come from shared/documents/versions.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { quoteBadgeStatus, quoteState } from "../../shared/documents/versions";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-467 (p8-pair5-a) the panel pill agrees with the document line", () => {
  test("REQ-467 a sent quote at version 2 badges 'revised', like quoteState", () => {
    const q = { status: "sent", sentAt: "2026-11-01", version: 2 };
    expect(quoteState(q)).toBe("revised");
    expect(quoteBadgeStatus(q)).toBe("revised");
  });

  test("REQ-467 a viewed quote at version 3 badges 'revised' too", () => {
    expect(quoteBadgeStatus({ status: "viewed", sentAt: "x", version: 3 }))
      .toBe("revised");
  });

  test("REQ-467 version 1 keeps its lifecycle word", () => {
    expect(quoteBadgeStatus({ status: "draft" })).toBe("draft");
    expect(quoteBadgeStatus({ status: "sent", version: 1 })).toBe("sent");
    expect(quoteBadgeStatus({ sentAt: "x" })).toBe("sent");
    expect(quoteBadgeStatus({ status: "viewed", sentAt: "x" })).toBe("viewed");
  });

  test("REQ-467 signed and lost quotes never read 'revised'", () => {
    expect(quoteBadgeStatus({ status: "accepted", version: 2 })).toBe(
      "accepted",
    );
    expect(
      quoteBadgeStatus({ status: "viewed", acceptedAt: "x", version: 2 }),
    ).toBe("accepted");
    expect(quoteBadgeStatus({ status: "lost", version: 2 })).toBe("declined");
  });

  test("REQ-467 an unsent draft revision stays 'draft'", () => {
    expect(quoteBadgeStatus({ status: "draft", version: 2 })).toBe("draft");
  });

  test("REQ-467 QuotesPage renders the shared badge, not a private one", () => {
    const page = read("front-end/islands/QuotesPage.tsx");
    expect(page).not.toMatch(/function badgeStatusFor/);
    expect(page).toMatch(/const badge = quoteBadgeStatus\(q\)/);
  });

  test("REQ-467 quotesPage.status.revised exists in en and es, with a style", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["quotesPage.status.revised"]).toBe("Revised");
    expect(typeof es["quotesPage.status.revised"]).toBe("string");
    expect(es["quotesPage.status.revised"].length).toBeGreaterThan(0);
    expect(read("front-end/static/quotes.css")).toContain(
      ".qopen__badge--revised",
    );
  });
});
