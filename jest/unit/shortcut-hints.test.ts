/**
 * REQ-287 — "fix every issue the demo found": demo issue test-setup-claims-m2
 * ("The ⌘N and ⌘K shortcut hints advertise shortcuts that have no handler").
 *
 * RCA (demo-rca.md, test-m2): AsstThreads rendered a "⌘N" chip on "New
 * conversation" (lang asstThreads.newKbd) and AsstComposer rendered
 * "<kbd>⌘K</kbd> commands" under the input. The only key handler in the app is
 * GlobalSearch's "/" (which ignores meta/ctrl), so neither shortcut did
 * anything — and Cmd/Ctrl+N opens a new browser window, which a page cannot
 * intercept, so the ⌘N hint could never work.
 *
 * The rule pinned here: the UI never advertises a modifier shortcut
 * (⌘/Ctrl/⌥/Alt + key) that no keydown handler binds. A hint is allowed only
 * when some island checks the modifier AND compares against that key.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..");
const SRC_DIRS = [
  "front-end/islands",
  "front-end/components",
  "front-end/routes",
];
const LANGS = ["en", "es"];

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

const sources = SRC_DIRS.flatMap(walk).map((f) => ({
  file: f,
  text: fs.readFileSync(path.join(ROOT, f), "utf8"),
}));

/** "⌘N", "⌘K", "Ctrl+K", "Alt+N", "⌥N" → the advertised key, upper-cased */
const HINT = /(?:⌘|⌥|\b(?:Ctrl|Alt|Cmd)\s*\+\s*)([A-Za-z0-9])/g;

interface Hint {
  where: string;
  key: string;
}

function hintsIn(where: string, text: string): Hint[] {
  return [...text.matchAll(HINT)].map((m) => ({
    where,
    key: m[1].toUpperCase(),
  }));
}

/** true when some source binds <modifier>+key in a keydown handler */
function isBound(key: string): boolean {
  const k = key.toLowerCase();
  const keyTest = new RegExp(
    `(?:key\\s*===?\\s*["'\`](?:${k}|${key})["'\`]|code\\s*===?\\s*["'\`]Key${key}["'\`])`,
  );
  return sources.some(({ text }) =>
    /keydown/.test(text) &&
    /(?:metaKey|ctrlKey|altKey)\s*(?:&&|\))/.test(text) &&
    keyTest.test(text)
  );
}

describe("REQ-287 (demo test-setup-claims-m2): no shortcut hint without a handler", () => {
  it("REQ-287: no island/component/route renders a modifier-key hint nobody binds", () => {
    const hints = sources.flatMap(({ file, text }) => hintsIn(file, text));
    const dead = hints.filter((h) => !isBound(h.key));
    expect(dead).toEqual([]);
  });

  it("REQ-287: no dictionary string advertises a modifier-key hint nobody binds (en + es)", () => {
    const hints = LANGS.flatMap((lang) => {
      const dict: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(ROOT, "lang", `${lang}.json`), "utf8"),
      );
      return Object.entries(dict).flatMap(([k, v]) =>
        typeof v === "string" ? hintsIn(`${lang}:${k}`, v) : []
      );
    });
    const dead = hints.filter((h) => !isBound(h.key));
    expect(dead).toEqual([]);
  });

  it("REQ-287: the New-conversation button carries no ⌘N chip (Cmd/Ctrl+N belongs to the browser)", () => {
    const threads = fs.readFileSync(
      path.join(ROOT, "front-end/islands/AsstThreads.tsx"),
      "utf8",
    );
    expect(threads).not.toMatch(/threads__new-kbd/);
    expect(threads).not.toMatch(/asstThreads\.newKbd/);
  });

  it("REQ-287: the composer hint keeps send/new line and drops the dead ⌘K 'commands'", () => {
    const composer = fs.readFileSync(
      path.join(ROOT, "front-end/islands/AsstComposer.tsx"),
      "utf8",
    );
    expect(composer).toMatch(/asstComposer\.hintSend/);
    expect(composer).toMatch(/asstComposer\.hintNewLine/);
    expect(composer).not.toMatch(/asstComposer\.hintCommands/);
  });
});
