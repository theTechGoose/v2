/**
 * REQ-590 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle 4 (run r857a9d67), issues M33 and p4-p6d, both from REQ-414's EN | ES toggle on /verify:
 *
 * - M33: the toggle re-rendered the page but never reached the account — CodeInput posted
 *   verify-otp with { phoneNumber, code } only, so a sign-up sent from the English landing was
 *   born English and /welcome came up in English after ES was picked on the code page.
 * - p4-p6d: the dev code was TAKEN (read and removed) on CodeInput's mount, so the toggle's
 *   full-page navigation mounted CodeInput again with nothing left — the popup vanished.
 *
 * Target: front-end/lib/dev-code.ts (peek, clear), front-end/islands/CodeInput.tsx.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const devCode = require("../../front-end/lib/dev-code.ts");

describe("REQ-590 (p4-p6d) the dev code survives /verify's language toggle", () => {
  beforeEach(() => {
    (globalThis as unknown as { sessionStorage: MemoryStorage })
      .sessionStorage = new MemoryStorage();
  });

  test("peeking leaves the code for the next mount of /verify (the toggle's navigation)", () => {
    devCode.stashDevCode("+15125550590", "482913");
    expect(devCode.peekDevCode("+15125550590")).toBe("482913");
    // the EN | ES link reloads /verify: CodeInput mounts again and still finds it
    expect(devCode.peekDevCode("+15125550590")).toBe("482913");
  });

  test("another phone's code is not shown", () => {
    devCode.stashDevCode("+15125550590", "482913");
    expect(devCode.peekDevCode("+15125550000")).toBeNull();
  });

  test("clearing removes it (a signed-in verify, a closed popup), so nothing stale comes back", () => {
    devCode.stashDevCode("+15125550590", "482913");
    devCode.clearDevCode();
    expect(devCode.peekDevCode("+15125550590")).toBeNull();
  });

  test("a resend's new code replaces the old one", () => {
    devCode.stashDevCode("+15125550590", "482913");
    devCode.stashDevCode("+15125550590", "771204");
    expect(devCode.peekDevCode("+15125550590")).toBe("771204");
  });
});

describe("REQ-590 CodeInput wires the toggle's language and the kept code", () => {
  const code = read("front-end/islands/CodeInput.tsx");

  test("(M33) verify-otp carries the language showing on /verify", () => {
    const call = code.match(/verifyClient\.verifyOtp\(\{[\s\S]*?\}\)/)?.[0] ??
      "";
    expect(call).toMatch(/language:\s*langSignal\.value/);
    expect(read("front-end/clients/verify.ts")).toMatch(
      /interface VerifyOtpInput \{[\s\S]*?language\?: Lang;[\s\S]*?\}/,
    );
  });

  test("(p4-p6d) mount peeks the code; a resend re-stashes it; sign-in and close clear it", () => {
    expect(code).toMatch(/peekDevCode\(phoneNumber\)/);
    expect(code).not.toMatch(/takeDevCode/);
    expect(code).toMatch(/stashDevCode\(\s*phoneNumber[^)]*sent\.devCode/);
    expect(code).toMatch(/clearDevCode\(\)/);
    expect((code.match(/clearDevCode\(\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });
});
