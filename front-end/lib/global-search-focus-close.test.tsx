/**
 * REQ-976 (LOOP-007 cycle 1, q1-57) — the header search dropdown stays open
 * with a stale "Nada coincide con “512”" after focus moves to another field.
 *
 * GlobalSearch (front-end/islands/GlobalSearch.tsx) closes its panel only on
 * an outside mousedown, Escape or a row pick. So:
 *   1. focus leaving the island without a mouse (Tab, a programmatic focus)
 *      leaves the panel up — there is no blur/focusout close;
 *   2. a debounced /search answer that lands after the user clicked away
 *      re-opens the panel (`setOpen(true)` in the fetch callback).
 * Both are proven here by mounting the real island into deno-dom.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { type ComponentType, render } from "preact";
import { act } from "preact/test-utils";
import * as esbuild from "npm:esbuild@0.25.12";
import { dashboardClient } from "../clients/dashboard.ts";

/**
 * front-end/deno.json compiles JSX with `"jsx": "precompile"` — template
 * strings that preact-render-to-string understands but a client `render()`
 * mounts as nothing. The browser gets the island through Vite's automatic
 * JSX transform, so compile the REAL island source the same way (esbuild,
 * automatic runtime) and import that; every import it makes resolves to the
 * very modules this test imports, so the stubbed dashboardClient is the one
 * the island calls.
 */
async function loadIsland(): Promise<ComponentType> {
  const src = new URL("../islands/GlobalSearch.tsx", import.meta.url);
  const { code } = await esbuild.transform(await Deno.readTextFile(src), {
    loader: "tsx",
    jsx: "automatic",
    jsxImportSource: "preact",
  });
  await esbuild.stop();
  const resolved = code.replace(
    /(from\s+|import\s*\(\s*)"([^"]+)"/g,
    (_m, pre: string, spec: string) =>
      `${pre}"${
        spec.startsWith(".")
          ? new URL(spec, src).href
          : import.meta.resolve(spec)
      }"`,
  );
  const dir = await Deno.makeTempDir();
  const file = `${dir}/GlobalSearch.dom.js`;
  await Deno.writeTextFile(file, resolved);
  try {
    return (await import(`file://${file}`)).default as ComponentType;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const GlobalSearch = await loadIsland();

const PANEL = "[data-cy=global-search-results]";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Doc = ReturnType<DOMParser["parseFromString"]> & object;

/** mount the island next to an unrelated field (the /communications area-code input) */
async function mount() {
  const doc = new DOMParser().parseFromString(
    "<html><body><div id=r></div><input id=other></body></html>",
    "text/html",
  )! as Doc;
  // deno-dom has no SVG namespace; the island's search icon is decoration
  (doc as unknown as { createElementNS: unknown }).createElementNS = (
    _ns: string,
    tag: string,
  ) => doc.createElement(tag);
  // Preact names a listener `oninput`→"input" only when `"oninput" in el`; deno-dom
  // elements carry no on* props, so give them the browser's (else "Input", "FocusOut")
  const elProto = Object.getPrototypeOf(
    Object.getPrototypeOf(doc.createElement("input")),
  );
  for (
    const p of [
      "oninput",
      "onfocus",
      "onblur",
      "onfocusin",
      "onfocusout",
      "onkeydown",
      "onmousedown",
      "onmouseenter",
      "onclick",
    ]
  ) {
    for (
      let o = elProto; o && o !== Object.prototype; o = Object.getPrototypeOf(o)
    ) {
      if (!(p in o)) {
        Object.defineProperty(o, p, {
          value: null,
          writable: true,
          configurable: true,
        });
      }
    }
  }
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = doc;
  const root = doc.getElementById("r") as unknown as Element;
  await act(() => {
    render(<GlobalSearch />, root);
  });
  const input = doc.querySelector("input[role=combobox]")!;
  const other = doc.getElementById("other")!;
  return {
    doc,
    input,
    other,
    panel: () => doc.querySelector(PANEL),
    async unmount() {
      await act(() => {
        render(null, root);
      });
      g.document = prev;
    },
  };
}

type Node_ = { dispatchEvent(e: Event): boolean; parentNode?: unknown };

/**
 * dispatch like a browser: deno-dom nodes are plain EventTargets with no
 * propagation, so a bubbling event is re-dispatched on every ancestor up to
 * the document, each copy keeping the original `target` and `relatedTarget`.
 */
function fire(
  target: unknown,
  type: string,
  init: { bubbles?: boolean; relatedTarget?: unknown } = {},
) {
  const bubbles = init.bubbles ?? true;
  for (
    let node = target as Node_ | null;
    node;
    node = bubbles ? (node.parentNode as Node_ | null) ?? null : null
  ) {
    const ev = new Event(type, { bubbles });
    if (node !== target) {
      Object.defineProperty(ev, "target", { value: target });
    }
    if ("relatedTarget" in init) {
      Object.defineProperty(ev, "relatedTarget", { value: init.relatedTarget });
    }
    node.dispatchEvent(ev);
  }
}

/** type into the box the way a browser does: set the value, fire `input` */
async function type(input: unknown, value: string) {
  const el = input as { value: string; dispatchEvent(e: Event): boolean };
  await act(() => {
    el.value = value;
    fire(el, "input");
  });
}

/** focus moves from the search box to another field — keyboard/programmatic, no mousedown */
async function moveFocus(input: unknown, other: unknown, doc: unknown) {
  await act(() => {
    Object.defineProperty(doc, "activeElement", {
      value: other,
      configurable: true,
    });
    const i = input as { dispatchEvent(e: Event): boolean };
    fire(i, "blur", { bubbles: false, relatedTarget: other });
    fire(i, "focusout", { bubbles: true, relatedTarget: other });
  });
}

Deno.test("REQ-976 q1-57: after '512' answers 'no match', moving focus to another field (Tab / programmatic focus) closes the search panel", async () => {
  const realSearch = dashboardClient.search;
  (dashboardClient as { search: unknown }).search = () =>
    Promise.resolve({ results: [] });
  const m = await mount();
  try {
    await act(() => fire(m.input, "focus", { bubbles: false }));
    await type(m.input, "512");
    await act(() => wait(400)); // past the 250 ms debounce + the answer
    const panel = m.panel();
    assert(panel, "precondition: the panel is open while the box has focus");
    assertEquals(panel.getAttribute("data-state"), "ready");
    assert(
      m.doc.querySelector("[data-cy=global-search-empty]"),
      "precondition: the 'no match' line shows",
    );

    await moveFocus(m.input, m.other, m.doc);
    await act(() => wait(50));
    assertEquals(
      m.panel(),
      null,
      "REQ-976: focus left the search box but the panel still shows the stale 'no match' for '512'",
    );
  } finally {
    await m.unmount();
    (dashboardClient as { search: unknown }).search = realSearch;
  }
});

Deno.test("REQ-976 q1-57: typing '512' then clicking another field before the debounced answer lands — the late answer does not re-open the panel", async () => {
  const realSearch = dashboardClient.search;
  let answer: (v: { results: [] }) => void = () => {};
  let asked = 0;
  (dashboardClient as { search: unknown }).search = () => {
    asked++;
    return new Promise((r) => answer = r);
  };
  const m = await mount();
  try {
    await act(() => fire(m.input, "focus", { bubbles: false }));
    await type(m.input, "512");
    assert(m.panel(), "precondition: typing opens the panel");

    // the user clicks the area-code field right away (mousedown outside, then focus moves)
    await act(() => fire(m.other, "mousedown"));
    await moveFocus(m.input, m.other, m.doc);
    assertEquals(m.panel(), null, "precondition: the outside click closed it");

    await act(() => wait(400)); // the debounce fires; /search is in flight
    assertEquals(asked, 1, "precondition: the debounced search went out");
    await act(async () => {
      answer({ results: [] });
      await wait(20);
    });
    assertEquals(
      m.panel(),
      null,
      "REQ-976: the late /search answer re-opened the panel after focus had moved away",
    );
  } finally {
    await m.unmount();
    (dashboardClient as { search: unknown }).search = realSearch;
  }
});
