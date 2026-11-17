/**
 * REQ-339 — demo-loop cycle 1, issue p2 "Chat timestamps a minute early":
 * the "Quote + Agreement sent — emailed to …" card is the send continue_cta
 * re-rendered in its sent state, and its `msg__time` printed the CTA's own
 * createdAt (when the wizard finished) — 1–2 minutes before the send. The
 * island must stamp that card with the dispatch time from the phase-3
 * divider (`sentCtaTimestamp`), falling back to the CTA's time when unsent.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/AsstChat.tsx"),
  "utf8",
);

const ctaBranch = (() => {
  const start = src.indexOf('if (m.kind === "continue_cta") {');
  const end = src.indexOf('if (m.kind === "wizard") {', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
})();

describe("REQ-339 (demo p2) the sent card's time is the dispatch time", () => {
  test("AsstChat imports sentCtaTimestamp from the settled-CTA module", () => {
    expect(src).toMatch(
      /import \{[^}]*\bsentCtaTimestamp\b[^}]*\} from "\.\.\/lib\/send-cta-settled\.ts"/,
    );
  });

  test("the continue_cta branch does not print the CTA's own createdAt", () => {
    expect(ctaBranch).not.toMatch(/fmtTime\(m\.createdAt/);
  });

  test("the continue_cta branch stamps the sent card with sentCtaTimestamp", () => {
    expect(ctaBranch).toMatch(/sentCtaTimestamp\(/);
    expect(ctaBranch).toMatch(
      /<div class="msg__time">\s*\{fmtTime\(\s*reviewed\s*\?\s*sentCtaTimestamp\(messages, m, quote\)\s*:\s*m\.createdAt,/,
    );
  });
});
