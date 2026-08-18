/**
 * Pure-logic formatting contracts. Proposes a NEW module
 *   shared/quote-flow/format-helpers.ts
 * (intended red: the module does not exist yet — module-dependent tests
 * lazy-require it so the import-free P-66 asset-budget test still runs and
 * fails for its OWN reason, not a "cannot find module" crash).
 *
 * Expected exports (all pure, no I/O):
 *   relativeTime(then, now, lang): string
 *     - lang "es": "hace 3 min", "hace 2 días" (localized; never "3m ago")
 *     - lang "en": an English relative string (e.g. "2d ago")
 *   sentenceCase(s): string                      // "your client…" → "Your client…"
 *   formatPhoneDisplay(raw): string              // "5125556999" → "+1 (512) 555-6999"
 *   telHref(raw): string                         // "5125556999" → "tel:+15125556999"
 *   formatNumber(n, lang): string                // ONE convention both langs → "48,215"
 *   hasAddress(client): boolean                  // false for empty/missing address
 *   capitalizeDateLine(line, lang): string       // "viernes · agosto 17" → "Viernes · agosto 17"
 *
 * Wiring sites (for the green agent):
 *   P-34/P-59 relativeTime — front-end/lib/clients-display.ts (lastWhenRel) and
 *             backend build-customer-cards relativeTime; notif ticker fmtRel.
 *   P-64 formatPhoneDisplay/telHref — front-end/islands/ClientsBoard.tsx phone row.
 *   P-64 hasAddress — front-end/lib/clients-display.ts addressFor gate.
 *   P-65 capitalizeDateLine — front-end/islands/DashTopbar.tsx greetingDate.
 */
import * as fs from "fs";
import * as path from "path";

// Lazy accessor so a missing module only reds the tests that use it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fh = () => require("../../shared/quote-flow/format-helpers");

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

describe("P-34/P-59 relativeTime — localized to the viewer", () => {
  const now = new Date("2026-08-18T12:00:00Z");

  it("P-34 es renders '3 min' with 'hace', never the raw English 'Xm ago'", () => {
    const { relativeTime } = fh();
    const then = new Date(now.getTime() - 3 * MIN);
    expect(relativeTime(then, now, "es")).toBe("hace 3 min");
  });

  it("P-34 es renders days as 'hace 2 días' (never 'ago')", () => {
    const { relativeTime } = fh();
    const then = new Date(now.getTime() - 2 * DAY);
    const out = relativeTime(then, now, "es");
    expect(out).toBe("hace 2 días");
    expect(out).not.toMatch(/ago/i);
  });

  it("P-34 en renders an English relative string for the same instant", () => {
    const { relativeTime } = fh();
    const then = new Date(now.getTime() - 2 * DAY);
    const out = relativeTime(then, now, "en");
    expect(out).toMatch(/2/);
    expect(out).toMatch(/ago/i);
  });
});

describe("P-59 sentenceCase — event strings start with a capital", () => {
  it("P-59 capitalizes a lowercase-initial event sentence", () => {
    const { sentenceCase } = fh();
    expect(sentenceCase("your client signed the contract")).toBe(
      "Your client signed the contract",
    );
  });

  it("P-59 leaves an already-capitalized string unchanged", () => {
    const { sentenceCase } = fh();
    expect(sentenceCase("María García rechazó tu orden de cambio")).toBe(
      "María García rechazó tu orden de cambio",
    );
  });
});

describe("P-64 phone formatting — one formatter everywhere", () => {
  it("P-64 formatPhoneDisplay normalizes a raw 10-digit number", () => {
    const { formatPhoneDisplay } = fh();
    expect(formatPhoneDisplay("5125556999")).toBe("+1 (512) 555-6999");
  });

  it("P-64 formatPhoneDisplay is idempotent on an already +1 number", () => {
    const { formatPhoneDisplay } = fh();
    expect(formatPhoneDisplay("+15125556999")).toBe("+1 (512) 555-6999");
  });

  it("P-64 telHref emits a +1-prefixed tel: URI", () => {
    const { telHref } = fh();
    expect(telHref("5125556999")).toBe("tel:+15125556999");
    expect(telHref("+1 (512) 555-6999")).toBe("tel:+15125556999");
  });
});

describe("P-64 formatNumber — one number locale per language", () => {
  it("P-64 es and en use the SAME grouping convention", () => {
    const { formatNumber } = fh();
    // ONE documented convention: comma thousands (Mexican/neutral-LatAm and en
    // agree), so a page never mixes "$10,990" with "48.215".
    expect(formatNumber(48215, "es")).toBe("48,215");
    expect(formatNumber(48215, "en")).toBe("48,215");
    expect(formatNumber(48215, "es")).toBe(formatNumber(48215, "en"));
  });
});

describe("P-64 hasAddress — no address claim without an address", () => {
  it("P-64 is false for missing / blank / whitespace address", () => {
    const { hasAddress } = fh();
    expect(hasAddress({})).toBe(false);
    expect(hasAddress({ address: "" })).toBe(false);
    expect(hasAddress({ address: "   " })).toBe(false);
  });

  it("P-64 is true only when a real address exists", () => {
    const { hasAddress } = fh();
    expect(hasAddress({ address: "123 Main St" })).toBe(true);
  });
});

describe("P-65 capitalizeDateLine — ES date line starts with a capital", () => {
  it("P-65 capitalizes the leading weekday only", () => {
    const { capitalizeDateLine } = fh();
    expect(capitalizeDateLine("viernes · agosto 17", "es")).toBe("Viernes · agosto 17");
  });
});

describe("P-66 logo-email.png asset budget", () => {
  it("P-66 if front-end/static/logo-email.png exists it is under 300KB", () => {
    // Import-free: runs regardless of the format-helpers module state.
    const p = path.resolve(__dirname, "../../front-end/static/logo-email.png");
    if (!fs.existsSync(p)) return; // removed/unreferenced is also acceptable
    const bytes = fs.statSync(p).size;
    expect(bytes).toBeLessThan(300 * 1024);
  });
});
