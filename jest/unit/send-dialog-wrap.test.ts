/**
 * REQ-716 — demo-loop cycle 5, issue p2 "Text cut off or wrapping badly".
 *
 * In Spanish the send dialog showed "Texto + Correo" on three lines: the
 * "can't receive texts" note was `white-space: nowrap` and squeezed the
 * channel label to its min-content width. The browser story
 * (e2e/send-dialog-wrap) measures the real layout; these pin the rules so a
 * later edit cannot quietly drop one.
 */
import * as fs from "fs";
import * as path from "path";

const FE = path.join(__dirname, "../../front-end");
const read = (p: string) => fs.readFileSync(path.join(FE, p), "utf8");
const CSS = read("static/assistant-page.css");

/** the declarations of `selector { … }` (all top-level occurrences joined) */
function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1]).join(";");
}

describe("REQ-716 p2: the send dialog's channel label never wraps; the note does", () => {
  test("QuoteSendDialog renders the channel label in a .send-dialog__option-label span", () => {
    const src = read("components/QuoteSendDialog.tsx");
    expect(src).toMatch(
      /<span class="send-dialog__option-label">\s*\{tFor\(lang, key\)\}/,
    );
  });

  test("the label keeps its one line and its width", () => {
    const label = rule(CSS, ".send-dialog__option-label");
    expect(label).toMatch(/white-space\s*:\s*nowrap/);
    expect(label).toMatch(/flex-shrink\s*:\s*0/);
  });

  test("the 'can't receive texts' / 'needs an email' note wraps instead of squeezing the label", () => {
    const needs = rule(CSS, ".send-dialog__needs");
    expect(needs).not.toMatch(/white-space\s*:\s*nowrap/);
    expect(needs).toMatch(/white-space\s*:\s*normal/);
    expect(needs).toMatch(/min-width\s*:\s*0/);
    expect(needs).toMatch(/text-align\s*:\s*right/);
  });
});

describe("REQ-716 p2: the sidebar is wide enough for the Spanish labels", () => {
  test("every stylesheet's .sb is 228px, so 'Vista del trabajador' and 'Órdenes de trabajo' fit on one line", () => {
    for (
      const sheet of [
        "static/assistant-page.css",
        "static/assistant.css",
        "static/dashboard.css",
      ]
    ) {
      const widths = [
        ...rule(read(sheet), ".sb").matchAll(/(?:^|;|\s)width\s*:\s*(\d+)px/g),
      ].map((m) => Number(m[1]));
      // the desktop rail is 228px (a phone drawer may be wider); never 216
      expect({ sheet, rail: widths.includes(228), old: widths.includes(216) })
        .toEqual({ sheet, rail: true, old: false });
    }
  });
});
