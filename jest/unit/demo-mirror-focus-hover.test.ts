/**
 * REQ-824 (demo-loop cycle dm1, m2) — the customer's hover and focus, shown on the stage.
 *
 * Demo 2: "focused: green border on the customer, unfocused pink fill on the stage"; the chip and
 * the calendar day under her mouse lit up only on her screen, and so did the search box's ×.
 * `:hover`, `:focus`, `:focus-visible` and `:focus-within` are browser state the DOM mirror never
 * carried, and the stage's inert frame (REQ-293) can never be in it. Now the recorder marks what
 * the customer's own browser says matches (data-mirror-focus / -focus-within / -hover), and the
 * stage rewrites the customer's rules in place to read the marks.
 *
 * 1. the selector rewrite (pure) · 2. the in-place walk over a sheet's rules · 3. the recorder's
 * marks, end to end on the fake DOM (record → JSON → replay) · 4. the replay: its frame's sheets
 * restated, and its own sheet of the UA's state rules.
 */
import {
  createRecorder,
  type RecorderOptions,
} from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame, Op } from "../../shared/demo-mode/mirror";
import {
  FOCUS_ATTR,
  HOVER_ATTR,
  MIRROR_UA_CSS,
  restateRules,
  restateSelector,
  type StateRule,
  WITHIN_ATTR,
} from "../../shared/demo-mode/mirror-state";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  findAll,
  h,
} from "./support/fake-dom";

// ---- 1. the selector rewrite ----

describe("REQ-824 (cycle dm1, m2) — restateSelector: the four state pseudo-classes read the stage's marks", () => {
  test("REQ-824 each pseudo-class becomes its attribute selector — one class-level part for another: the same specificity", () => {
    expect(restateSelector(".composer__inner:focus-within")).toBe(
      ".composer__inner[data-mirror-focus-within]",
    );
    expect(restateSelector(".dur__chip:hover:not(:disabled)")).toBe(
      ".dur__chip[data-mirror-hover]:not(:disabled)",
    );
    expect(restateSelector(".recovery-card__input:focus")).toBe(
      ".recovery-card__input[data-mirror-focus]",
    );
    expect(restateSelector(".quote-review__send-main:focus-visible")).toBe(
      '.quote-review__send-main[data-mirror-focus="visible"]',
    );
  });

  test("REQ-824 every occurrence: inside :not/:is/:where/:has/:nth-child(of), across lists and combinators, nested (&), before a pseudo-element, in any case", () => {
    const cases: [string, string][] = [
      [".btn:not(:hover)", ".btn:not([data-mirror-hover])"],
      [
        ":is(a, button):focus-visible",
        ':is(a, button)[data-mirror-focus="visible"]',
      ],
      [".card:has(input:focus)", ".card:has(input[data-mirror-focus])"],
      [
        ":where(.a:hover) > .b, .c:focus .d",
        ":where(.a[data-mirror-hover]) > .b, .c[data-mirror-focus] .d",
      ],
      [
        "li:nth-child(2n + 1 of .x:hover)",
        "li:nth-child(2n + 1 of .x[data-mirror-hover])",
      ],
      ["&:hover", "&[data-mirror-hover]"],
      ["a:hover::after", "a[data-mirror-hover]::after"],
      [
        ".cal__day:hover:not(:disabled):not(.cal__day--selected)",
        ".cal__day[data-mirror-hover]:not(:disabled):not(.cal__day--selected)",
      ],
      [".x:HOVER", ".x[data-mirror-hover]"],
      [
        ".a:hover:focus-within + .b ~ .c:focus-visible",
        '.a[data-mirror-hover][data-mirror-focus-within] + .b ~ .c[data-mirror-focus="visible"]',
      ],
    ];
    for (const [from, to] of cases) expect(restateSelector(from)).toBe(to);
  });

  test("REQ-824 left as they are: a state after a pseudo-element (it is the pseudo-element's), escaped colons, attribute values and strings, look-alike names", () => {
    for (
      const s of [
        "::-webkit-scrollbar-thumb:hover",
        ".x::part(thumb):hover",
        ".x::-webkit-search-cancel-button:hover",
        '[title=":hover"]',
        "[data-x='a:focus']",
        ".hover\\:bg-red",
        ".a:hovered",
        ".a:focus-ring",
        ":lang(en)",
        ".composer__inner",
      ]
    ) expect(restateSelector(s)).toBe(s);
    expect(restateSelector(".hover\\:bg-red:hover")).toBe(
      ".hover\\:bg-red[data-mirror-hover]",
    );
    expect(restateSelector('[title=":hover"]:hover')).toBe(
      '[title=":hover"][data-mirror-hover]',
    );
    expect(restateSelector(".x::slotted(.y:hover)")).toBe(
      ".x::slotted(.y[data-mirror-hover])",
    );
  });

  test("REQ-824 a rewritten selector rewritten again stays as it is", () => {
    for (
      const s of [
        ".composer__inner:focus-within",
        ".btn:not(:hover), a:focus-visible::after",
        ".card:has(input:focus) .x:hover",
      ]
    ) {
      const once = restateSelector(s);
      expect(once).not.toBe(s);
      expect(restateSelector(once)).toBe(once);
    }
  });
});

// ---- 2. the in-place walk over a sheet's rules ----

/** a CSSOM style rule as a browser has it: its `selectorText` takes what it parses (`refuse`: a
 *  selector this browser would not take), and its cssText follows */
function styleRule(sel: string, kids?: unknown[], refuse = false) {
  let s = sel;
  const r = {
    sets: 0,
    get selectorText() {
      return s;
    },
    set selectorText(v: string) {
      r.sets++;
      if (!refuse) s = v;
    },
    get cssText() {
      return `${s} { color: red; }`;
    },
    cssRules: kids,
  };
  return r;
}

describe("REQ-824 (cycle dm1, m2) — restateRules: a sheet's rules read the marks, in place", () => {
  test("REQ-824 style rules at every depth (@media/@supports/@layer blocks, nested rules, an @import's sheet) are rewritten where they are; the others are never touched", () => {
    const focus = styleRule(".composer__inner:focus-within");
    const plain = styleRule(".composer__inner");
    const nested = styleRule("&:hover");
    const parent = styleRule(".n", [nested]);
    const inMedia = styleRule(".wiz-opt:hover");
    const media = { cssRules: [inMedia] }; // @media (hover: hover) { … }
    const imported = styleRule(".x:focus-visible");
    const imp = { styleSheet: { cssRules: [imported] } };
    const keyframes = { cssRules: [{ keyText: "0%" }] };
    const n = restateRules(
      [focus, plain, parent, media, imp, keyframes] as unknown as StateRule[],
    );
    expect(focus.selectorText).toBe(
      ".composer__inner[data-mirror-focus-within]",
    );
    expect(nested.selectorText).toBe("&[data-mirror-hover]");
    expect(inMedia.selectorText).toBe(".wiz-opt[data-mirror-hover]");
    expect(imported.selectorText).toBe('.x[data-mirror-focus="visible"]');
    expect(plain.sets).toBe(0);
    expect(parent.sets).toBe(0);
    expect(n).toBe(4);
  });

  test("REQ-824 a rule the browser will not take rewritten keeps its selector and the walk goes on; an @import of another origin (rules unreadable) is passed over", () => {
    const refused = styleRule(".a:hover", undefined, true);
    const foreign = {
      styleSheet: {
        get cssRules(): never {
          throw new Error("SecurityError: Cannot access rules");
        },
      },
    };
    const after = styleRule(".b:focus");
    const n = restateRules(
      [refused, foreign, after] as unknown as StateRule[],
    );
    expect(refused.selectorText).toBe(".a:hover");
    expect(after.selectorText).toBe(".b[data-mirror-focus]");
    expect(n).toBe(1);
  });
});

// ---- 3. the recorder's marks, record → JSON → replay ----

function record(
  doc: FDocument,
  out: MirrorFrame[],
  extra: Partial<RecorderOptions> = {},
) {
  return createRecorder(doc as unknown as Document, {
    emit: (f) => out.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
    ...extra,
  });
}

function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}

const noLayout = { schedule: (fn: () => void) => fn(), Resize: null };

/** the customer's page: the composer (a field and a button in a form), two duration chips, the
 *  top search with "Tom" typed, and the demo pill (never mirrored) */
function customerPage(): FDocument {
  return docWith((d) =>
    h(
      d,
      "html",
      {},
      h(d, "head"),
      h(
        d,
        "body",
        {},
        h(
          d,
          "form",
          { "data-cy": "composer" },
          h(
            d,
            "div",
            { "data-cy": "composer-inner" },
            h(d, "textarea", { "data-cy": "composer-input" }),
            h(d, "button", { type: "button", "data-cy": "send" }, "Send"),
          ),
        ),
        h(
          d,
          "div",
          { "data-cy": "dur" },
          h(d, "button", { type: "button", "data-cy": "chip-1" }, "1 day"),
          h(d, "button", { type: "button", "data-cy": "chip-2" }, "2–3 days"),
        ),
        h(d, "input", { type: "search", "data-cy": "search", value: "Tom" }),
        h(
          d,
          "div",
          { "data-demo-overlay": "" },
          h(d, "button", { type: "button", "data-cy": "pill-end" }, "End"),
        ),
      ),
    )
  );
}

/** a customer page, recorded, its snapshot replayed on a stage */
function setup() {
  const doc = customerPage();
  const frames: MirrorFrame[] = [];
  const rec = record(doc, frames);
  rec.snapshot();
  const stage = stageDoc();
  const rep = createReplayer(stage as unknown as Document, noLayout);
  expect(rep.apply(frames[0])).toBe(true);
  let at = 1;
  /** the recorder's changes so far, applied on the stage */
  const sync = () => {
    rec.flush();
    for (; at < frames.length; at++) {
      expect(rep.apply(frames[at])).toBe(true);
    }
  };
  const cy = (v: string) =>
    find(doc, (e) => e.getAttribute("data-cy") === v) as FElement;
  return { doc, rec, rep, stage, frames, sync, cy };
}

/** the elements under `root` that carry `attr`, in document order: their data-cy (else their
 *  tag), with "=value" when the mark has one */
function marked(root: FDocument, attr: string): string[] {
  return findAll(root, (e) => e.hasAttribute(attr)).map((e) => {
    const name = e.getAttribute("data-cy") ?? e.localName;
    const v = e.getAttribute(attr);
    return v ? `${name}=${v}` : name;
  });
}

const COMPOSER_CHAIN = [
  "html",
  "body",
  "composer",
  "composer-inner",
  "composer-input",
];

describe("REQ-824 (cycle dm1, m2) — the recorder marks the customer's hover and focus, and the stage has the marks", () => {
  test("REQ-824 the customer clicks into the composer: its field is marked focused (visible: a text field's focus always shows), the field and every ancestor focus-within, nothing hovered", () => {
    const { doc, stage, sync, cy } = setup();
    expect(marked(stage, FOCUS_ATTR)).toEqual([]);
    doc.focused = cy("composer-input");
    doc.fire("focusin", doc.focused);
    sync();
    expect(marked(stage, FOCUS_ATTR)).toEqual(["composer-input=visible"]);
    expect(marked(stage, WITHIN_ATTR)).toEqual(COMPOSER_CHAIN);
    expect(marked(stage, HOVER_ATTR)).toEqual([]);
  });

  test("REQ-824 focus moves to the search box: the marks move with it, in one frame; a blur takes them all off", () => {
    const { doc, stage, sync, cy, frames } = setup();
    doc.focused = cy("composer-input");
    sync();
    const before = frames.length;
    doc.focused = cy("search");
    sync();
    expect(frames.length).toBe(before + 1);
    expect(marked(stage, FOCUS_ATTR)).toEqual(["search=visible"]);
    expect(marked(stage, WITHIN_ATTR)).toEqual(["html", "body", "search"]);
    doc.focused = null;
    sync();
    expect(marked(stage, FOCUS_ATTR)).toEqual([]);
    expect(marked(stage, WITHIN_ATTR)).toEqual([]);
  });

  test("REQ-824 a button focused by a click is marked focused but not visible; once the customer's browser shows its focus (after a key), the mark says visible", () => {
    const { doc, stage, sync, cy } = setup();
    doc.focusVisible = false;
    doc.focused = cy("send");
    sync();
    expect(marked(stage, FOCUS_ATTR)).toEqual(["send"]);
    expect(
      find(stage, (e) => e.getAttribute("data-cy") === "send")!.getAttribute(
        FOCUS_ATTR,
      ),
    ).toBe("");
    doc.focusVisible = true;
    sync();
    expect(marked(stage, FOCUS_ATTR)).toEqual(["send=visible"]);
  });

  test("REQ-824 the customer's mouse over the '2–3 days' chip: the chip and every ancestor are marked hovered; over the other chip the marks move; off the page there are none", () => {
    const { doc, stage, sync, cy } = setup();
    doc.hovered = cy("chip-2");
    sync();
    expect(marked(stage, HOVER_ATTR)).toEqual([
      "html",
      "body",
      "dur",
      "chip-2",
    ]);
    doc.hovered = cy("chip-1");
    sync();
    expect(marked(stage, HOVER_ATTR)).toEqual([
      "html",
      "body",
      "dur",
      "chip-1",
    ]);
    doc.hovered = null;
    sync();
    expect(marked(stage, HOVER_ATTR)).toEqual([]);
  });

  test("REQ-824 a stage that joins late sees the marks: the snapshot carries them", () => {
    const { doc, rec, frames, cy } = setup();
    doc.focused = cy("composer-input");
    doc.hovered = cy("chip-2");
    rec.snapshot();
    const snap = frames[frames.length - 1];
    expect(snap.t).toBe("snap");
    const late = stageDoc();
    const rep = createReplayer(late as unknown as Document, noLayout);
    expect(rep.apply(snap)).toBe(true);
    expect(marked(late, FOCUS_ATTR)).toEqual(["composer-input=visible"]);
    expect(marked(late, WITHIN_ATTR)).toEqual(COMPOSER_CHAIN);
    expect(marked(late, HOVER_ATTR)).toEqual(["html", "body", "dur", "chip-2"]);
  });

  test("REQ-824 a dialog that opens with its field focused carries the marks in the frame that brings it", () => {
    const { doc, stage, sync } = setup();
    const field = h(doc, "input", { "data-cy": "dialog-name" });
    doc.body!.appendChild(h(doc, "div", { "data-cy": "dialog" }, field));
    doc.focused = field;
    sync();
    expect(marked(stage, FOCUS_ATTR)).toEqual(["dialog-name=visible"]);
    expect(marked(stage, WITHIN_ATTR)).toEqual([
      "html",
      "body",
      "dialog",
      "dialog-name",
    ]);
  });

  test("REQ-824 the page's own data-mirror-focus, -focus-within and -hover never cross, in a frame or a snapshot: only the recorder marks state", () => {
    const { rec, frames, stage, sync, cy } = setup();
    cy("chip-1").setAttribute(HOVER_ATTR, "");
    cy("composer-input").setAttribute(FOCUS_ATTR, "visible");
    cy("composer").setAttribute(WITHIN_ATTR, "");
    sync();
    for (const a of [HOVER_ATTR, FOCUS_ATTR, WITHIN_ATTR]) {
      expect(marked(stage, a)).toEqual([]);
    }
    rec.snapshot();
    const late = stageDoc();
    createReplayer(late as unknown as Document, noLayout).apply(
      frames[frames.length - 1],
    );
    for (const a of [HOVER_ATTR, FOCUS_ATTR, WITHIN_ATTR]) {
      expect(marked(late, a)).toEqual([]);
    }
  });

  test("REQ-824 focus inside what never crosses (the demo pill): nothing is marked focused, and its crossing ancestors are focus-within, as they are on the customer's screen", () => {
    const { doc, stage, sync, cy } = setup();
    doc.focused = cy("pill-end");
    sync();
    expect(marked(stage, FOCUS_ATTR)).toEqual([]);
    expect(marked(stage, WITHIN_ATTR)).toEqual(["html", "body"]);
  });

  test("REQ-824 the customer's window loses focus: :focus stops matching on their screen, and the stage's focus marks go", () => {
    const { doc, stage, sync, cy } = setup();
    doc.focused = cy("composer-input");
    sync();
    expect(marked(stage, FOCUS_ATTR)).toEqual(["composer-input=visible"]);
    doc.windowFocused = false;
    sync();
    expect(marked(stage, FOCUS_ATTR)).toEqual([]);
    expect(marked(stage, WITHIN_ATTR)).toEqual([]);
  });

  test("REQ-824 a customer whose pointer cannot hover (a phone: (hover: none)) sends no hover marks — the sticky :hover a tap leaves would light up, on the presenter's desktop, rules the page keeps for real hover; focus still crosses", () => {
    const { doc, stage, sync, cy } = setup();
    (doc.defaultView as unknown as {
      matchMedia: (q: string) => { matches: boolean };
    }).matchMedia = (q) => ({
      matches: q.replace(/\s+/g, "") === "(hover:none)",
    });
    doc.hovered = cy("chip-2");
    doc.focused = cy("composer-input");
    sync();
    expect(marked(stage, HOVER_ATTR)).toEqual([]);
    expect(marked(stage, FOCUS_ATTR)).toEqual(["composer-input=visible"]);
  });

  test("REQ-824 the marks never touch the customer's own page", () => {
    const { doc, sync, cy } = setup();
    doc.focused = cy("composer-input");
    doc.hovered = cy("chip-2");
    sync();
    expect(
      findAll(
        doc,
        (e) =>
          e.hasAttribute(FOCUS_ATTR) || e.hasAttribute(WITHIN_ATTR) ||
          e.hasAttribute(HOVER_ATTR),
      ),
    ).toEqual([]);
  });

  test("REQ-824 a focus change, a pointer crossing, a key and the window's blur each send a frame by themselves, within the flush (never left to the sweep)", () => {
    jest.useFakeTimers();
    try {
      const doc = customerPage();
      const frames: MirrorFrame[] = [];
      const rec = record(doc, frames, {
        manual: false,
        flushMs: 50,
        sweepMs: 1_000_000,
        scrollPollMs: 1_000_000,
        heartbeatMs: 1_000_000,
      });
      rec.snapshot();
      const ops = () => frames.slice(1).flatMap((f) => f.ops);
      const markOp = (n: string, v: string | null) =>
        ops().some((o: Op) => o.o === "a" && o.n === n && o.v === v);
      const el = (v: string) =>
        find(doc, (e) => e.getAttribute("data-cy") === v) as FElement;

      // a click focuses the send button (no visible focus): focusin
      doc.focusVisible = false;
      doc.focused = el("send");
      doc.fire("focusin", doc.focused);
      jest.advanceTimersByTime(60);
      expect(markOp(FOCUS_ATTR, "")).toBe(true);

      // a key makes it visible: keydown
      doc.focusVisible = true;
      doc.fire("keydown", doc.focused, { key: "a" });
      jest.advanceTimersByTime(60);
      expect(markOp(FOCUS_ATTR, "visible")).toBe(true);

      // the mouse crosses into a chip: pointerover
      doc.hovered = el("chip-2");
      doc.fire("pointerover", doc.hovered);
      jest.advanceTimersByTime(60);
      expect(markOp(HOVER_ATTR, "")).toBe(true);

      // the window loses focus: focusout on the focused element
      doc.windowFocused = false;
      doc.fire("focusout", el("send"));
      jest.advanceTimersByTime(60);
      expect(markOp(FOCUS_ATTR, null)).toBe(true);
      rec.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---- 4. the replay: its frame's sheets restated, its own UA sheet ----

/** the customer's page with one stylesheet and a chip */
function linkedPage(href = "https://app.test/assistant-page.css"): FDocument {
  return docWith((d) =>
    h(
      d,
      "html",
      {},
      h(d, "head", {}, h(d, "link", { rel: "stylesheet", href })),
      h(
        d,
        "body",
        {},
        h(d, "button", { type: "button", class: "dur__chip" }, "2–3 days"),
      ),
    )
  );
}
function snapOf(doc: FDocument): MirrorFrame {
  const frames: MirrorFrame[] = [];
  const rec = record(doc, frames);
  rec.snapshot();
  rec.stop();
  return frames[0];
}
const adopted = (stage: FDocument) =>
  stage.adoptedStyleSheets.map((s) => s.cssText);

describe("REQ-824 (cycle dm1, m2) — the replay rewrites its frame's sheets in place, and adopts the stage's own sheet of the UA's state rules", () => {
  test("REQ-824 once a snapshot is in, every sheet of the frame reads the marks; another origin's (rules unreadable) is left alone; a sheet is read once", () => {
    const stage = stageDoc();
    const focus = styleRule(".composer__inner:focus-within");
    const foreign = {
      get cssRules(): never {
        throw new Error("SecurityError: Cannot access rules");
      },
    };
    (stage as unknown as { styleSheets: unknown[] }).styleSheets = [
      { cssRules: [focus] },
      foreign,
    ];
    const rep = createReplayer(stage as unknown as Document, noLayout);
    expect(rep.apply(snapOf(customerPage()))).toBe(true);
    expect(focus.selectorText).toBe(
      ".composer__inner[data-mirror-focus-within]",
    );
    expect(focus.sets).toBe(1);
    expect(rep.apply({ t: "ops", ops: [] })).toBe(true);
    expect(focus.sets).toBe(1);
  });

  test("REQ-824 a stylesheet that loads after the snapshot is rewritten as it comes in, before the copy that styles the next page at once (REQ-547) is taken", () => {
    const stage = stageDoc();
    const rep = createReplayer(stage as unknown as Document, noLayout);
    const href = "https://app.test/assistant-page.css";
    expect(rep.apply(snapOf(linkedPage(href)))).toBe(true);
    const link = find(stage, (e) => e.localName === "link")!;
    const chip = styleRule(".dur__chip:hover:not(:disabled)");
    (link as unknown as { sheet: unknown }).sheet = { cssRules: [chip] };
    stage.fire("load", link);
    expect(chip.selectorText).toBe(
      ".dur__chip[data-mirror-hover]:not(:disabled)",
    );
    // the next page links the same sheet: it goes in at once, styled by a copy of its rules
    expect(rep.apply(snapOf(linkedPage(href)))).toBe(true);
    const copy = adopted(stage).find((t) => t.includes(".dur__chip"));
    expect(copy).toBeDefined();
    expect(copy).toContain(".dur__chip[data-mirror-hover]:not(:disabled)");
    expect(copy).not.toContain(":hover");
  });

  test("REQ-824 the stage adopts its own sheet of the UA's state rules — the focus ring on a visible focus, the search box's × while focused or hovered — in a layer every page rule beats; once, and still there after the page settled", () => {
    expect(MIRROR_UA_CSS).toMatch(/^@layer\s+[\w-]+\s*\{/);
    expect(MIRROR_UA_CSS).toContain(`[${FOCUS_ATTR}="visible"]`);
    expect(MIRROR_UA_CSS).toMatch(
      /outline:\s*auto 1px -webkit-focus-ring-color/,
    );
    expect(MIRROR_UA_CSS).toMatch(
      /input\[type="search" i\][^{]*\[data-mirror-focus\][^{]*\[data-mirror-hover\][^{]*::-webkit-search-cancel-button\s*\{\s*opacity:\s*1/,
    );
    const stage = stageDoc();
    const rep = createReplayer(stage as unknown as Document, noLayout);
    expect(rep.apply(snapOf(customerPage()))).toBe(true);
    expect(adopted(stage).filter((t) => t === MIRROR_UA_CSS).length).toBe(1);
    expect(rep.still()).toBe(false); // settled: the still rule was let go
    expect(rep.apply(snapOf(customerPage()))).toBe(true);
    expect(adopted(stage).filter((t) => t === MIRROR_UA_CSS).length).toBe(1);
  });
});
