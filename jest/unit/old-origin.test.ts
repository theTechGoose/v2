/**
 * REQ-086 / REQ-087 — Raphael, 2026-10-18: "fix it." — the site's own origin is
 * documonster.com everywhere the code still said paperworkmonster.com: the
 * backend's prod link fallbacks for texts and emails, and the wipe script's
 * default target. The old domain is a forwarder now — 404 for every path but
 * "/", 405 to a POST — so a link built on it is dead in a customer's inbox.
 *
 * The old domain survives only as a NAME, never a URL: the email domain and
 * the @paperworkmonster.com addresses, the CRM lead-source label, and the
 * frozen prototype pages under front-end/static/_proto/ (the mocks the pages
 * were built from, kept verbatim).
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const OLD_HOST = "paperworkmonster.com".replace(".", "\\.");
/** the old domain used as a URL: with a scheme, or with a path after it */
const OLD_URL_PATTERN = `https?://[a-z.]*${OLD_HOST}|[a-z.]*${OLD_HOST}/`;
const OLD_URL = new RegExp(OLD_URL_PATTERN, "i");
/** the mocks the pages were built from — frozen, not code */
const FROZEN = ["front-end/static/_proto/"];

const COORDINATORS = "backend/src/paperwork/domain/coordinators";
/** every coordinator that puts a customer-facing link in a text, an email or a PDF */
const LINK_BUILDERS = [
  "send-paperwork-sms",
  "send-paperwork-email",
  "send-signed-confirmation",
  "send-accepted-alert",
  "send-inquiry-alert",
  "send-change-order-alert",
  "send-payment-reminder",
  "confirm-payment",
  "render-invoice-pdf",
].map((name) => `${COORDINATORS}/${name}/mod.ts`);

const SITE_META_IMPORT =
  /import \{ SITE_ORIGIN \} from "#quote-flow\/site-meta\.ts";/;

/** every tracked, non-markdown line that uses the old domain as a URL: "path:line:text" */
function trackedOldUrlLines(): string[] {
  let out = "";
  try {
    out = execSync(`git grep -n -I -E '${OLD_URL_PATTERN}' -- . ':!*.md'`, {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    if (err.status !== 1) throw e; // 1 = no match; anything else is a real failure
    out = err.stdout ?? "";
  }
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => !FROZEN.some((prefix) => line.startsWith(prefix)))
    .map((line) => line.slice(0, 140));
}

describe("REQ-086: the backend's prod link fallbacks point at documonster.com", () => {
  test("REQ-086: no tracked source names paperworkmonster.com as a URL", () => {
    expect(trackedOldUrlLines()).toEqual([]);
  });

  test("REQ-086: every link-building coordinator's prod fallback is SITE_ORIGIN", () => {
    for (const file of LINK_BUILDERS) {
      const src = read(file);
      expect(`${file}: ${src.match(OLD_URL)?.[0] ?? "no old url"}`).toBe(
        `${file}: no old url`,
      );
      expect(
        `${file}: ${
          SITE_META_IMPORT.test(src) ? "imports" : "does not import"
        } SITE_ORIGIN`,
      )
        .toBe(`${file}: imports SITE_ORIGIN`);
      expect(
        `${file}: ${
          /\?\?\s*SITE_ORIGIN|\?\s*SITE_ORIGIN\s*:/.test(src)
            ? "falls back to"
            : "never falls back to"
        } SITE_ORIGIN`,
      )
        .toBe(`${file}: falls back to SITE_ORIGIN`);
    }
  });
});

describe("REQ-087: the wipe script targets documonster.com by default", () => {
  test("REQ-087: the wipe script's default target is SITE_ORIGIN", () => {
    const src = read("backend/scripts/wipe.ts");
    expect(src).toMatch(SITE_META_IMPORT);
    expect(src).toMatch(/const DEFAULT_URL = SITE_ORIGIN;/);
    expect(src).not.toMatch(OLD_URL);
  });
});
