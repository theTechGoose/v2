/**
 * REQ-123 — Raphael, 2026-10-27: "i do not want to SEND ANYTHING VIA
 * monsterrg.com can we send everything via documonster instead?"
 *
 * Until now three senders were in play, none of them documonster.com: the box
 * env's POSTMARK_FROM (warnings@monsterrg.com — every gate run and dev pin),
 * main/.env's (rafac@monsterrg.com), prod's on Deno Deploy
 * (noreply@quotejefe.com), and the paperwork alias domain in code
 * (<alias>@paperworkmonster.com). Now one module owns the sender: the house
 * From and the alias domain are documonster.com, no env var has a say, and
 * no tracked source names the old sender domains or the retired variable.
 * The team inbox keeps its monsterrg.com RECIPIENTS — that is where mail
 * lands, not where it leaves from.
 */
import { execSync } from "child_process";
import { aliasFrom, HOUSE_FROM, SEND_DOMAIN } from "../../backend/src/communication/domain/business/sender/mod";

const ROOT = `${__dirname}/../..`;

/** tracked lines matching an extended regex, outside markdown and the frozen prototypes */
function trackedLines(pattern: string, excludes: string[] = []): string[] {
  const pathspec = [".", ":!*.md", ":!front-end/static/_proto/", ...excludes].map((p) => `'${p}'`).join(" ");
  try {
    return execSync(`git grep -n -I -E '${pattern}' -- ${pathspec}`, { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter(Boolean).map((l) => l.slice(0, 140));
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    if (err.status !== 1) throw e; // 1 = no match
    return [];
  }
}

/** an address on one of the old sender domains (spelled the way old-origin.test.ts spells the old domain) */
const OLD_SENDER_DOMAINS = ["paperworkmonster.com", "quotejefe.com"].map((d) => `@${d.replace(".", "\\.")}`).join("|");

describe("REQ-123: every email leaves from documonster.com", () => {
  test("REQ-123: the house From and the alias domain are documonster.com", () => {
    expect(SEND_DOMAIN).toBe("documonster.com");
    expect(HOUSE_FROM).toBe('"DocuMonster" <hello@documonster.com>');
    expect(aliasFrom("acme-roofing")).toBe("acme-roofing@documonster.com");
    expect(aliasFrom(undefined)).toBe("noreply@documonster.com");
  });

  // the tests name the retired senders on purpose — to prove each one is refused
  const TESTS = ":!*test.ts";

  test("REQ-123: no tracked source reads POSTMARK_FROM — the sender is code, not an env var", () => {
    expect(trackedLines("POSTMARK_FROM", [TESTS])).toEqual([]);
  });

  test("REQ-123: no tracked source names an address on the old sender domains", () => {
    // cypress/ keeps one fixture contractor whose OWN email is on the old domain: a recipient, not a sender
    expect(trackedLines(OLD_SENDER_DOMAINS, [TESTS, ":!cypress/"])).toEqual([]);
  });

  test("REQ-123: monsterrg.com is named by the backend only where mail LANDS (the team inbox) and in the sender module's account of what it retired", () => {
    const files = new Set(trackedLines("monsterrg", [TESTS, ":!e2e/"]).map((l) => l.split(":")[0]));
    expect([...files].sort()).toEqual([
      "backend/src/communication/domain/business/sender/mod.ts",
      "backend/src/communication/domain/business/team-inbox/mod.ts",
    ]);
  });
});
