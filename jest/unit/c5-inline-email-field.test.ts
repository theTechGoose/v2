/**
 * REQ-634 — demo-loop cycle 5, issue m34 (run r37f88707): "Inline 'agregar
 * correo' field broken (25 px box, Enter inserts newline, email twice) and the
 * stage draws it overlapping".
 *
 * The quote review's customer email/phone were contentEditable <span>s whose
 * text was a Preact child, with no keydown handling and a CSS ::before
 * placeholder shown only `--empty:not(:focus)`. Focus hid the hint and left a
 * 25 px box, Enter inserted a line break, the blur re-render left the typed
 * text next to Preact's own (the email twice), and the demo stage — whose
 * mirrored copy is never focused — drew the placeholder over the typed text.
 *
 * Now they are real <input>s: native placeholder, a min-width, Enter commits
 * (blur), Escape reverts. Pure key rule: front-end/lib/hero-field-edit.ts.
 */
import * as fs from "fs";
import * as path from "path";

// Lazy accessor so a missing module reds only the tests that use it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hf = () => require("../../front-end/lib/hero-field-edit");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-634 (cycle 5, m34) hero-field-edit — the inline field's keys", () => {
  it("REQ-634 Enter commits, Escape reverts, anything else types", () => {
    const { heroFieldKeyAction } = hf();
    expect(heroFieldKeyAction("Enter")).toBe("commit");
    expect(heroFieldKeyAction("Escape")).toBe("revert");
    expect(heroFieldKeyAction("a")).toBeNull();
    expect(heroFieldKeyAction("Tab")).toBeNull();
  });

  it("REQ-634 an Enter that confirms an IME composition does not commit", () => {
    const { heroFieldKeyAction } = hf();
    expect(heroFieldKeyAction("Enter", true)).toBeNull();
    expect(heroFieldKeyAction("Escape", true)).toBeNull();
  });
});

describe("REQ-634 (cycle 5, m34) wiring — the email/phone are real inputs", () => {
  const src = read("front-end/islands/AsstChat.tsx");
  const css = read("front-end/static/assistant-page.css");
  // the customer's own row: the hero-meta that holds "add email"
  const meta = (() => {
    const at = src.indexOf('"asstChat.preview.addEmail"');
    expect(at).toBeGreaterThan(-1);
    const i = src.lastIndexOf('<div class="quote-review__hero-meta">', at);
    expect(i).toBeGreaterThan(-1);
    return src.slice(i, src.indexOf("{/* REQ-263", i));
  })();

  it("REQ-634 no contentEditable hero field (Preact child + browser edits = email twice)", () => {
    expect(meta).not.toMatch(/contentEditable/);
    // the email is no Preact text child of an element
    expect(meta).not.toMatch(/>\s*\{customer\.email \?\? ""\}/);
  });

  it("REQ-634 the email is an <input type=email> with a native placeholder and key handling", () => {
    expect(meta).toMatch(/<input[\s\S]*?type="email"/);
    expect(meta).toMatch(
      /placeholder=\{tFor\(\s*lang,\s*"asstChat\.preview\.addEmail"/,
    );
    expect(meta).toMatch(/<input[\s\S]*?type="tel"/);
    expect(meta).toMatch(
      /placeholder=\{tFor\(\s*lang,\s*"asstChat\.preview\.addPhone"/,
    );
    expect(meta).toContain("onKeyDown={onHeroFieldKeyDown}");
    expect(src).toContain("heroFieldKeyAction(");
  });

  it("REQ-634 the blur handler reads the input's value, not innerText", () => {
    const i = src.indexOf("async function onEditCustomerField(");
    const body = src.slice(i, src.indexOf("\n  }\n", i));
    expect(body).not.toContain("innerText");
    expect(body).toContain(".value");
  });

  it("REQ-634 the CSS has no focus-based ::before placeholder; the input keeps a min-width", () => {
    expect(css).not.toMatch(/hero-field--empty:not\(:focus\)::before/);
    const rule = css.match(/\.quote-review__hero-input\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/min-width:\s*\d/);
    expect(rule![1]).toMatch(/field-sizing:\s*content/);
    expect(css).toMatch(/\.quote-review__hero-input::placeholder/);
    expect(css).toMatch(/\.quote-review__hero-field:focus-within/);
  });
});
