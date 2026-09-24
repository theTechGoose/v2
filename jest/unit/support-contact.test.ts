/**
 * REQ-044 — "change the number everywhere on the site to 855-362-8666. add
 * the phone number to the footer on every page as well as the address."
 *
 * The support number and the mailing address live in ONE shared module that
 * every page (and the site footer) reads. These tests pin the module's values,
 * pin that the module is the only place in the site source that spells the
 * number out, and pin that the old toll-free number is gone.
 */
import * as fs from "fs";
import * as path from "path";
import {
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_E164,
  SUPPORT_PHONE_HREF,
} from "../../shared/legal/contact";
import { TERMS_OF_SERVICE } from "../../shared/legal/terms";
import { TERMS_OF_SERVICE_ES } from "../../shared/legal/terms.es";

const ROOT = path.resolve(__dirname, "../..");
/** The site source: everything that renders a page. Not the reverse-
 *  documentation under front-end/ui-breakdown (spec snapshots) nor the
 *  build output under front-end/_fresh. */
const SITE_DIRS = [
  "front-end/routes",
  "front-end/islands",
  "front-end/components",
  "front-end/lib",
  "front-end/static",
  "shared",
  "lang",
];
const EXT = /\.(tsx?|jsx?|json|css|html)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "_fresh") continue;
      walk(p, out);
    } else if (EXT.test(entry.name)) out.push(p);
  }
  return out;
}

const siteFiles = () => SITE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

const OLD_NUMBER = /866[^0-9a-z]{0,3}767[^0-9a-z]{0,3}8399/i;
const NEW_NUMBER = /855[^0-9a-z]{0,3}362[^0-9a-z]{0,3}8666/i;

describe("REQ-044 one shared contact module carries 855-362-8666 and its tel: href", () => {
  it("REQ-044 one shared contact module carries 855-362-8666 and its tel: href", () => {
    expect(SUPPORT_PHONE_DISPLAY).toBe("855-362-8666");
    expect(SUPPORT_PHONE_E164).toBe("+18553628666");
    expect(SUPPORT_PHONE_HREF).toBe("tel:+18553628666");
  });

  it("REQ-044 the shared module is the only site source that spells the number out", () => {
    const spelled = siteFiles()
      .filter((f) => NEW_NUMBER.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(spelled).toEqual(["shared/legal/contact.ts"]);
  });
});

describe("REQ-044 the old toll-free number is gone from the site source", () => {
  it("REQ-044 the old toll-free number is gone from the site source", () => {
    const stale = siteFiles()
      .filter((f) => OLD_NUMBER.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(stale).toEqual([]);
  });
});

describe("REQ-044 the footer address is the legal mailing address", () => {
  it("REQ-044 the footer address is the legal mailing address", () => {
    expect(BUSINESS_ADDRESS).toBe("4505 Socastee Blvd, Myrtle Beach, SC 29588");
    // The same address the Terms carry (REQ-043 amendment), EN and ES.
    expect(JSON.stringify(TERMS_OF_SERVICE)).toContain(BUSINESS_ADDRESS);
    expect(JSON.stringify(TERMS_OF_SERVICE_ES)).toContain(BUSINESS_ADDRESS);
  });
});
