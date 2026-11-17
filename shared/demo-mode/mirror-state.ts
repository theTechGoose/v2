/**
 * REQ-824 (demo-loop cycle dm1, m2) — the customer's hover and focus, on the stage.
 *
 * `:hover`, `:focus`, `:focus-visible` and `:focus-within` are the browser's state, never an
 * attribute, so the REQ-242 mirror never carried them; and the stage's replica can never be in any
 * of them itself (its frame is inert, untabbable and takes no pointer — REQ-293). The stage showed
 * the composer the customer was typing in with its idle fill, never what her mouse was over, and
 * never the search box's × (Chromium shows it only on a focused or hovered search box).
 *
 * So the recorder (mirror-record.ts) marks what the customer's own browser says matches, as
 * REQ-638 marks an open select — attributes only it sets (the page's own never cross):
 *
 *   - FOCUS_ATTR on the element that matches `:focus`: "visible" when it matches `:focus-visible`
 *     too, else "";
 *   - WITHIN_ATTR on every element that matches `:focus-within` (the focused one, its ancestors);
 *   - HOVER_ATTR on every element that matches `:hover` (the one under the pointer, its ancestors).
 *
 * And the stage (mirror-replay.ts) rewrites the customer's style rules IN PLACE to read them
 * (`restateRules`, `restateSelector`): each of the four pseudo-classes becomes its attribute
 * selector — one class-level part for another, so the specificity is the same, and the rule stays
 * where it was, so the cascade is the customer's (an adopted copy would come after every rule of
 * the page and win ties it loses there; and a `:not(:hover)` must stop matching, not just gain a
 * twin). A pseudo-class after a pseudo-element (`::-webkit-scrollbar-thumb:hover`) is the
 * pseudo-element's state: left as it is.
 *
 * The UA's own state rules are in no sheet of the page's: MIRROR_UA_CSS is the stage's copy of the
 * ones that show — the focus ring and the search box's × — in a cascade layer, under every rule of
 * the page's (the app's sheets have no layers), as a UA rule is.
 */

/** the element that matches `:focus` ("visible": `:focus-visible` too) */
export const FOCUS_ATTR = "data-mirror-focus";
/** every element that matches `:focus-within` */
export const WITHIN_ATTR = "data-mirror-focus-within";
/** every element that matches `:hover` */
export const HOVER_ATTR = "data-mirror-hover";

/** each state pseudo-class, and the attribute selector it becomes on the stage */
const STATES: Record<string, string> = {
  hover: `[${HOVER_ATTR}]`,
  focus: `[${FOCUS_ATTR}]`,
  "focus-visible": `[${FOCUS_ATTR}="visible"]`,
  "focus-within": `[${WITHIN_ATTR}]`,
};

/**
 * Chromium's UA rules that show the four states, measured in Chromium 156: a visible focus draws
 * `outline: auto 1px -webkit-focus-ring-color` (offset 1px on a link, 2px on a checkbox or radio);
 * a search box's cancel button is `opacity: 0` unless the box is enabled, editable, and focused or
 * hovered. In a layer: every rule of the page's beats them, as it beats a UA rule.
 */
export const MIRROR_UA_CSS = "@layer mirror-ua{" +
  `[${FOCUS_ATTR}="visible"]{outline:auto 1px -webkit-focus-ring-color}` +
  `a:any-link[${FOCUS_ATTR}="visible"]{outline-offset:1px}` +
  `input:is([type="checkbox" i],[type="radio" i])[${FOCUS_ATTR}="visible"]{outline-offset:2px}` +
  `input[type="search" i]:enabled:read-write:is([${FOCUS_ATTR}],[${HOVER_ATTR}])` +
  `::-webkit-search-cancel-button{opacity:1}` +
  "}";

/** the parts of a CSSOM rule the restate reads and writes (a browser's CSSRule, or a test's) */
export interface StateRule {
  selectorText?: string;
  cssText?: string;
  /** a grouping rule's (@media, @supports, @layer…) or a style rule's nested rules */
  cssRules?: ArrayLike<StateRule> | null;
  /** an @import's sheet */
  styleSheet?: { cssRules?: ArrayLike<StateRule> | null } | null;
}

/** a selector names one of the states at all (an escaped `\:hover` in a class name included) */
const MENTIONS = /:(hover|focus)/i;
/** legacy one-colon pseudo-elements: a state after one of them is the pseudo-element's */
const OLD_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);
const HEX = /[0-9a-fA-F]/;
const SPACE = /[ \t\n\r\f]/;

const nameChar = (c: string) =>
  /[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80;

/** the index just past the escape that starts at `i` (a backslash): a hex one takes up to six
 *  digits and one whitespace after them */
function pastEscape(s: string, i: number): number {
  let j = i + 1;
  if (j >= s.length) return j;
  if (!HEX.test(s[j])) return j + 1;
  for (let n = 0; j < s.length && n < 6 && HEX.test(s[j]); n++) j++;
  if (s[j] === "\r" && s[j + 1] === "\n") return j + 2;
  return j < s.length && SPACE.test(s[j]) ? j + 1 : j;
}

/** the index just past the quoted string that starts at `i` */
function pastString(s: string, i: number): number {
  const q = s[i];
  let j = i + 1;
  while (j < s.length && s[j] !== q) j = s[j] === "\\" ? j + 2 : j + 1;
  return Math.min(j + 1, s.length);
}

/** the index of the bracket closing the one at `i` (`(` or `[`) — strings, escapes and an
 *  attribute selector's brackets skipped; s.length when it never closes */
function closing(s: string, i: number): number {
  const open = s[i];
  const close = open === "(" ? ")" : "]";
  let depth = 0;
  for (let j = i; j < s.length;) {
    const c = s[j];
    if (c === "\\") {
      j = pastEscape(s, j);
      continue;
    }
    if (c === '"' || c === "'") {
      j = pastString(s, j);
      continue;
    }
    if (c === "[" && open === "(") {
      j = closing(s, j) + 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j;
    j++;
  }
  return s.length;
}

function rewrite(s: string): string {
  let out = "";
  /** a pseudo-element came earlier in this compound: a state after it is the pseudo-element's */
  let afterElement = false;
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "\\") {
      const j = pastEscape(s, i);
      out += s.slice(i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      const j = pastString(s, i);
      out += s.slice(i, j);
      i = j;
    } else if (c === "[") {
      const j = closing(s, i);
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === "(") {
      // a functional pseudo-class's argument (:not, :is, :where, :has, :nth-child(… of S)…): a
      // selector list of its own
      const j = closing(s, i);
      out += "(" + rewrite(s.slice(i + 1, j)) + (j < s.length ? ")" : "");
      i = j + 1;
    } else if (c === ":") {
      const element = s[i + 1] === ":";
      let j = i + (element ? 2 : 1);
      let name = "";
      while (j < s.length && (nameChar(s[j]) || s[j] === "\\")) {
        const k = s[j] === "\\" ? pastEscape(s, j) : j + 1;
        name += s.slice(j, k);
        j = k;
      }
      const lname = name.toLowerCase();
      if (element || OLD_ELEMENTS.has(lname)) {
        afterElement = true;
        out += s.slice(i, j);
      } else if (STATES[lname] && !afterElement && s[j] !== "(") {
        out += STATES[lname];
      } else out += s.slice(i, j);
      i = j;
    } else {
      // a combinator or a list's comma starts a new compound
      if (c === "," || c === ">" || c === "+" || c === "~" || SPACE.test(c)) {
        afterElement = false;
      }
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * REQ-824 — `sel` reading the stage's marks: `:hover` → `[data-mirror-hover]`, `:focus` →
 * `[data-mirror-focus]`, `:focus-visible` → `[data-mirror-focus="visible"]`, `:focus-within` →
 * `[data-mirror-focus-within]`, wherever they are (inside :not/:is/:where/:has too) — except after
 * a pseudo-element. Escapes, strings and attribute selectors are passed over whole. The same
 * string when there is nothing to rewrite; rewriting again changes nothing.
 */
export function restateSelector(sel: string): string {
  return MENTIONS.test(sel) ? rewrite(sel) : sel;
}

/**
 * REQ-824 — every style rule under `rules` (grouping rules, nested rules and @import'ed sheets
 * included) reads the stage's marks instead of the four state pseudo-classes, in place (its
 * `selectorText` set). A rule the browser will not take rewritten keeps its selector; a sheet of
 * another origin, whose rules cannot be read, is passed over. Says how many rules were rewritten.
 */
export function restateRules(
  rules: ArrayLike<StateRule> | null | undefined,
  seen: Set<unknown> = new Set(),
): number {
  if (!rules) return 0;
  let n = 0;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    if (!r || typeof r !== "object") continue;
    try {
      const sel = r.selectorText;
      if (typeof sel === "string") {
        const next = restateSelector(sel);
        if (next !== sel) {
          r.selectorText = next;
          if (r.selectorText !== sel) n++;
        }
      }
      if (r.cssRules) n += restateRules(r.cssRules, seen);
      const sheet = r.styleSheet;
      if (sheet && !seen.has(sheet)) {
        seen.add(sheet);
        n += restateRules(sheet.cssRules, seen);
      }
    } catch {
      // another origin's rules (an import), or a rule this browser will not touch: left as it is
    }
  }
  return n;
}
