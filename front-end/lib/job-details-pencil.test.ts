/**
 * REQ-468 — Raphael: "fix every issue the demo found, loop until there are
 * none". Demo issue p5 (demo-loop cycle 3, run re05e1cbb): a stray DOUBLE
 * pencil icon rendered next to the "JOB DETAILS" section label.
 *
 * Root cause (RCA at cc5d4b0e): the Job Details edit button reused the
 * inline-term class `quote-review__term-edit`, whose `::after` paints a pencil
 * (CSS data-URI SVG) after every inline term value — and the button ALSO
 * holds an explicit `<Icon name="pencil">` (REQ-366 swapped the old ✎ glyph
 * for it), so two pencils stacked.
 *
 * Guard: the Job Details edit button keeps its <Icon> pencil and carries no
 * class that the stylesheet decorates with a `::after` pencil; the inline
 * term-value buttons keep their single CSS pencil.
 */
import { assert, assertEquals } from "@std/assert";

const FE = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const island = Deno.readTextFileSync(`${FE}/islands/AsstChat.tsx`);
const css = Deno.readTextFileSync(`${FE}/static/assistant-page.css`);

/** Classes whose `::after` rule draws a background-image (the pencil). */
function pencilAfterClasses(sheet: string): Set<string> {
  const out = new Set<string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of sheet.matchAll(rule)) {
    if (!/background-image\s*:\s*url\(["']?data:image\/svg/.test(m[2])) {
      continue;
    }
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      const hit = s.match(/^\.([\w-]+)(?::[\w-]+)*::after$/);
      if (hit) out.add(hit[1]);
    }
  }
  return out;
}

/** The opening `<button …>` tag + body up to `</button>` around a data-cy. */
function buttonAround(
  src: string,
  dataCy: string,
): { classes: string[]; body: string } {
  const at = src.indexOf(`data-cy="${dataCy}"`);
  assert(at > 0, `button data-cy="${dataCy}" not found in AsstChat.tsx`);
  const start = src.lastIndexOf("<button", at);
  const end = src.indexOf("</button>", at);
  const chunk = src.slice(start, end);
  const cls = chunk.match(/\bclass="([^"]*)"/);
  return {
    classes: cls ? cls[1].split(/\s+/).filter(Boolean) : [],
    body: chunk,
  };
}

Deno.test("REQ-468 p5: the Job Details edit button draws exactly one pencil (its <Icon>, no CSS ::after pencil)", () => {
  const pencils = pencilAfterClasses(css);
  const btn = buttonAround(island, "review-job-details-edit");
  assert(
    /<Icon\s+name="pencil"/.test(btn.body),
    'Job Details edit button lost its <Icon name="pencil">',
  );
  const doubled = btn.classes.filter((c) => pencils.has(c));
  assertEquals(
    doubled,
    [],
    `Job Details edit button class(es) ${
      doubled.join(", ")
    } also paint a ::after pencil → two pencils render`,
  );
});

// REQ-617 (cycle 4, p4-p3a) superseded the CSS ::after pencil on term values:
// each inline term-value button now draws exactly one pencil — the <Icon> in
// <TermEditValue> — and no ::after pencil.
Deno.test("REQ-468 p5 / REQ-617: inline term-value edit buttons draw a single pencil (the <TermEditValue> Icon, no ::after)", () => {
  assert(!pencilAfterClasses(css).has("quote-review__term-edit"));
  const at = island.indexOf('class="quote-review__term-edit"');
  assert(at > 0, "term-edit button not found in AsstChat.tsx");
  const body = island.slice(at, island.indexOf("</button>", at));
  assert(/<TermEditValue\s/.test(body), "term-edit lost its <TermEditValue>");
});
