/**
 * REQ-999 (LOOP-007 cycle 1, q1-77) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * QA saw the customer page's "Más ▾" button draw a red missing-glyph box at
 * phone size. Root cause: REQ-924's CustomerWorkspace writes the More caret as
 * a literal U+25BE (`{tFor(lang, "customerWs.act.more")} ▾`). The app's web
 * fonts carry no Geometric Shapes (REQ-366 / REQ-407), so the glyph falls back
 * per character and can draw as tofu. The rule is a UI icon is an inline SVG:
 * <Icon name="chevron-down">, as InvoicesPage's "Adjust invoice" (REQ-407).
 *
 * The island only reaches its action row after a client fetch, and the
 * front-end's `jsx: precompile` templates do not mount through preact's
 * client render() under deno-dom, so this reads the button's own JSX. The
 * rendered markup is pinned by e2e/customer-more-caret at 390x844.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { Icon } from "../components/ui/Icon.tsx";

/** Dingbats + Geometric Shapes — none are in the app's web fonts (REQ-366/407) */
const NO_FONT_GLYPH = /[✀-➿■-◿]/gu;

const SRC = Deno.readTextFileSync(
  new URL("../islands/CustomerWorkspace.tsx", import.meta.url),
);

/** the <button … data-cy="cws-more" …>…</button> element's source */
function moreButton(): string {
  const at = SRC.indexOf('data-cy="cws-more"');
  assert(at > 0, "CustomerWorkspace has the More button (data-cy=cws-more)");
  const start = SRC.lastIndexOf("<button", at);
  const end = SRC.indexOf("</button>", at);
  assert(start >= 0 && end > at, "the More button is a <button>…</button>");
  return SRC.slice(start, end + "</button>".length);
}

Deno.test("REQ-999 (q1-77): the customer page's More button has no literal ▾ (or any glyph the web fonts lack)", () => {
  const btn = moreButton();
  assertEquals(
    btn.match(NO_FONT_GLYPH) ?? [],
    [],
    `the More button's caret is a literal glyph that draws as a tofu box:\n${btn}`,
  );
});

Deno.test('REQ-999 (q1-77): the customer page\'s More button draws its caret as <Icon name="chevron-down">', () => {
  const btn = moreButton();
  assert(
    /<Icon\s+name="chevron-down"/.test(btn),
    `the More caret is <Icon name="chevron-down" />:\n${btn}`,
  );
  assert(
    /import\s*\{[^}]*\bIcon\b[^}]*\}\s*from\s*"\.\.\/components\/ui\/Icon\.tsx"/
      .test(SRC),
    "CustomerWorkspace imports Icon from components/ui/Icon.tsx",
  );
  // and that icon is the inline SVG, never a glyph
  const svg = renderToString(<Icon name="chevron-down" />);
  assert(svg.startsWith("<svg") && svg.includes('data-icon="chevron-down"'), svg);
  assertEquals(svg.match(NO_FONT_GLYPH) ?? [], [], svg);
});
