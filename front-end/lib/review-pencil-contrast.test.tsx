/**
 * REQ-617 — Raphael: "fix every issue the demo found, loop until there are
 * none". Demo issue p4-p3a (demo-loop cycle 4, run r857a9d67): the edit
 * pencils on the "Ready to send" review card were faint pink, and the
 * "Estimated: 4 hours" pencil wrapped onto a line of its own.
 *
 * Root cause (RCA at ad104a19): the pencil was a CSS `::after` — an 11px SVG
 * stroked #FF6B6B at `opacity: 0.40`, raised only on :hover (touch has no
 * hover). A free inline-block after the text with no nowrap binding it to the
 * last word, so it wrapped alone.
 *
 * Guards:
 *  - the remaining CSS `::after` pencil (contentEditable fields) rests at
 *    opacity >= 0.8, is stroked in the darker #d94e4e and is >= 13px;
 *  - the TERMS value buttons draw no `::after` pencil; their pencil is a real
 *    <Icon> inside a nowrap span together with the value's last word.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { splitLastWord, TermEditValue } from "../components/TermEditValue.tsx";

const FE = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const island = Deno.readTextFileSync(`${FE}/islands/AsstChat.tsx`);
const css = Deno.readTextFileSync(`${FE}/static/assistant-page.css`);

type Rule = { selectors: string[]; body: string };
function rules(sheet: string): Rule[] {
  const noComments = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim()),
    body: m[2],
  }));
}
const prop = (body: string, name: string) =>
  body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`))?.[1].trim();

/** The resting (no :hover/:focus/:disabled) ::after pencil rule for a class. */
function restingPencil(cls: string): Rule | undefined {
  return rules(css).find((r) =>
    r.selectors.includes(`.${cls}::after`) &&
    /background-image\s*:\s*url\(["']?data:image\/svg/.test(r.body)
  );
}

Deno.test("REQ-617 p4-p3a unit: splitLastWord keeps the last word apart from the head", () => {
  assertEquals(splitLastWord("Estimated: 4 hours"), ["Estimated: 4 ", "hours"]);
  assertEquals(splitLastWord("Net 30"), ["Net ", "30"]);
  assertEquals(splitLastWord("Cash"), ["", "Cash"]);
  assertEquals(splitLastWord("  trailing  "), ["  ", "trailing"]);
  assertEquals(splitLastWord(""), ["", ""]);
});

Deno.test("REQ-617 p4-p3a: the CSS pencil on editable review fields is legible at rest", () => {
  const r = restingPencil("quote-review__editable");
  assert(r, "no resting .quote-review__editable::after pencil rule");
  const opacity = Number(prop(r.body, "opacity") ?? "1");
  assert(opacity >= 0.8, `resting pencil opacity ${opacity} < 0.8`);
  assert(
    /stroke='%23d94e4e'/i.test(r.body),
    "pencil stroke is not the darker #d94e4e",
  );
  const width = parseFloat(prop(r.body, "width") ?? "0");
  assert(width >= 13, `pencil is ${width}px, want >= 13px`);
});

Deno.test("REQ-617 p4-p3a: TERMS value buttons draw no ::after pencil", () => {
  const hit = rules(css).filter((r) =>
    r.selectors.some((s) =>
      /^\.quote-review__term-edit(?::[\w-]+)*::after$/.test(s)
    ) &&
    /background-image/.test(r.body)
  );
  assertEquals(hit.length, 0, "a ::after pencil still paints on term-edit");
});

Deno.test("REQ-617 p4-p3a: TERMS value buttons render <TermEditValue> (Icon pencil bound to the last word)", () => {
  const at = island.indexOf('class="quote-review__term-edit"');
  assert(at > 0, "term-edit button not found in AsstChat.tsx");
  const body = island.slice(at, island.indexOf("</button>", at));
  assert(
    /<TermEditValue\s+value=\{t\.value\}\s*\/>/.test(body),
    "term-edit button does not render <TermEditValue value={t.value} />",
  );
});

Deno.test("REQ-617 p4-p3a integration: TermEditValue renders the pencil inside a nowrap span with the last word", () => {
  const html = renderToString(<TermEditValue value="Estimated: 4 hours" />);
  const tail = html.match(
    /<span class="quote-review__term-tail"[^>]*>([\s\S]*?)<\/span>/,
  );
  assert(tail, `no nowrap tail span in ${html}`);
  assert(
    tail[1].startsWith("hours"),
    `tail does not start with the last word: ${tail[1]}`,
  );
  assert(
    /<svg[\s\S]*<\/svg>/.test(tail[1]),
    "pencil <svg> is not inside the tail span",
  );
  assert(html.startsWith("Estimated: 4 "), `head text missing: ${html}`);
  const tailRule = rules(css).find((r) =>
    r.selectors.includes(".quote-review__term-tail")
  );
  assert(tailRule, "no .quote-review__term-tail rule");
  assertEquals(prop(tailRule.body, "white-space"), "nowrap");
  const iconRule = rules(css).find((r) =>
    r.selectors.includes(".quote-review__term-pencil")
  );
  assert(iconRule, "no .quote-review__term-pencil rule");
  const opacity = Number(prop(iconRule.body, "opacity") ?? "1");
  assert(opacity >= 0.8, `term pencil opacity ${opacity} < 0.8`);
  assert(
    /#d94e4e/i.test(prop(iconRule.body, "color") ?? ""),
    "term pencil color is not #d94e4e",
  );
});
