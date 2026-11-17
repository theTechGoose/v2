/**
 * REQ-821 AMENDMENT (demo-loop run 11, p2) — after a logout and a sign-in in the same tab, the
 * pill flashed open ("{name} · Connected · End") for ~200 ms and folded, and never said
 * "{name} is guiding you": the carry (REQ-830, sessionStorage, 30 s) survived the sign-out, so the
 * next page took the demo as "seen" (no join grace) with a stale place. A sign-in is a new
 * session: CodeInput forgets the carry before it leaves for the backend's redirectTo, so the first
 * page of the new session joins as a first join — whole, "{name} is guiding you", the grace.
 */
import * as fs from "fs";
import * as path from "path";
import {
  carriedDemo,
  forgetDemo,
  keepDemo,
} from "../../front-end/lib/demo-mode/pill-carry";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-821 AMENDMENT (demo-loop run 11, p2) — a sign-in forgets the carried demo", () => {
  test("wiring: CodeInput calls forgetDemo(sessionStore()) before every redirect of a verified code (the code, the recovery)", () => {
    const src = read("front-end/islands/CodeInput.tsx");
    expect(src).toMatch(
      /import \{ forgetDemo \} from "\.\.\/lib\/demo-mode\/pill-carry\.ts"/,
    );
    expect(src).toMatch(
      /import \{ sessionStore \} from "\.\.\/lib\/demo-mode\/cursor-handoff\.ts"/,
    );
    expect(src).toMatch(
      /forgetDemo\(sessionStore\(\)\);\s*setTimeout\(\(\) => \{\s*globalThis\.location\.href = result\.redirectTo;/,
    );
    expect(src).toMatch(
      /forgetDemo\(sessionStore\(\)\);\s*globalThis\.location\.href = res\.redirectTo;/,
    );
  });
  test("a forgotten carry is not carried: the next page's overlay finds nothing (arrives, grace)", () => {
    const m = new Map<string, string>();
    const store = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const demo = {
      id: "d1",
      role: "viewer" as const,
      presenterName: "Alex",
      targetName: "Maria",
      targetUserId: "u1",
      presenters: [],
    };
    keepDemo(store, demo, true, 1_000);
    expect(carriedDemo(store, 1_500)?.demo.id).toBe("d1");
    forgetDemo(store);
    expect(carriedDemo(store, 1_500)).toBeNull();
  });
});
