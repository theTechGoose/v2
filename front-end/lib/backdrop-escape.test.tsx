/**
 * REQ-732 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 5 (run r37f88707), issue m26 "Escape and backdrop click don't
 * close dialogs": New invoice and Nueva suscripción ignored Escape. Escape was
 * per-dialog and opt-in (only ClientsPage's New customer, REQ-289, had one), and
 * the shared <Backdrop> (REQ-354) wired the mouse only.
 *
 * The rule: every dialog on <Backdrop> closes on Escape. Only the topmost open
 * dialog closes; an Escape a nested list already handled (defaultPrevented, or
 * stopped before it reached the document) and an Escape that ends an IME
 * composition close nothing. Escape goes through `onEscape` when given, else
 * `onClose` — so the busy guards in `onClose` hold for Escape too.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { createEscapeLayers, type EscapeKeyEvent } from "./backdrop-dismiss.ts";
import Backdrop from "../components/Backdrop.tsx";

type Listener = (e: EscapeKeyEvent) => void;

function fakeDoc() {
  const listeners = new Set<Listener>();
  return {
    listeners,
    addEventListener: (_t: string, f: Listener) => {
      listeners.add(f);
    },
    removeEventListener: (_t: string, f: Listener) => {
      listeners.delete(f);
    },
    press(
      key: string,
      init: { defaultPrevented?: boolean; isComposing?: boolean } = {},
    ) {
      const e = {
        key,
        defaultPrevented: init.defaultPrevented ?? false,
        isComposing: init.isComposing ?? false,
        preventDefault() {
          e.defaultPrevented = true;
        },
      };
      for (const f of [...listeners]) f(e);
      return e;
    },
  };
}

Deno.test("REQ-732 m26: Escape closes the one open dialog and marks the key handled", () => {
  const doc = fakeDoc();
  const layers = createEscapeLayers(doc);
  let closed = 0;
  layers.push(() => closed++);
  const e = doc.press("Escape");
  assertEquals(closed, 1);
  assert(
    e.defaultPrevented,
    "the Escape is marked handled for other listeners",
  );
});

Deno.test("REQ-732 m26: only the topmost dialog closes; the next Escape closes the one under it", () => {
  const doc = fakeDoc();
  const layers = createEscapeLayers(doc);
  const log: string[] = [];
  const popLower = layers.push(() => log.push("lower"));
  const popUpper = layers.push(() => log.push("upper"));
  doc.press("Escape");
  assertEquals(log, ["upper"]);
  popUpper(); // the upper dialog unmounts
  doc.press("Escape");
  assertEquals(log, ["upper", "lower"]);
  popLower();
});

Deno.test("REQ-732 m26: a handled Escape, an IME composition and other keys close nothing", () => {
  const doc = fakeDoc();
  const layers = createEscapeLayers(doc);
  let closed = 0;
  layers.push(() => closed++);
  doc.press("Escape", { defaultPrevented: true });
  doc.press("Escape", { isComposing: true });
  doc.press("Enter");
  doc.press("Esc ");
  assertEquals(closed, 0);
});

Deno.test("REQ-732 m26: one document listener while any dialog is open, none after the last closes", () => {
  const doc = fakeDoc();
  const layers = createEscapeLayers(doc);
  assertEquals(doc.listeners.size, 0);
  const a = layers.push(() => {});
  const b = layers.push(() => {});
  assertEquals(doc.listeners.size, 1);
  a(); // out of order: the lower one unmounts first
  assertEquals(doc.listeners.size, 1);
  b();
  assertEquals(doc.listeners.size, 0);
  a(); // a second pop is harmless
  assertEquals(doc.listeners.size, 0);
});

Deno.test("REQ-732 m26: a closed-over layer that unmounted out of order never fires", () => {
  const doc = fakeDoc();
  const layers = createEscapeLayers(doc);
  const log: string[] = [];
  layers.push(() => log.push("lower"));
  const popUpper = layers.push(() => log.push("upper"));
  const popMiddleLater = layers.push(() => log.push("top"));
  popMiddleLater();
  popUpper();
  doc.press("Escape");
  assertEquals(log, ["lower"]);
});

function keydown(doc: { dispatchEvent(e: Event): boolean }, key: string) {
  const ev = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "key", { value: key });
  doc.dispatchEvent(ev);
  return ev;
}

Deno.test("REQ-732 m26: a mounted <Backdrop> closes on Escape (onEscape over onClose), and stops listening once unmounted", async () => {
  const doc = new DOMParser().parseFromString(
    "<html><body><div id=r></div></body></html>",
    "text/html",
  )!;
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = doc;
  try {
    const root = doc.getElementById("r") as unknown as Element;
    let closes = 0;
    let escapes = 0;
    await act(() => {
      render(<Backdrop onClose={() => closes++}>x</Backdrop>, root);
    });
    keydown(doc, "Escape");
    assertEquals(closes, 1, "Escape calls onClose");

    await act(() => {
      render(
        <Backdrop onClose={() => closes++} onEscape={() => escapes++}>
          x
        </Backdrop>,
        root,
      );
    });
    keydown(doc, "Escape");
    assertEquals(
      [closes, escapes],
      [1, 1],
      "onEscape, when given, replaces onClose",
    );

    await act(() => {
      render(null, root);
    });
    keydown(doc, "Escape");
    assertEquals([closes, escapes], [1, 1], "nothing after unmount");
  } finally {
    g.document = prev;
  }
});

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

Deno.test("REQ-732 m26: ClientsPage drops its own Escape listener — its Backdrop's onEscape closes the New customer modal (not while saving; a dirty draft is kept, REQ-300)", () => {
  const s = src("../islands/ClientsPage.tsx");
  assert(
    !/addEventListener\(\s*["']keydown["']/.test(s),
    "ClientsPage still registers its own keydown listener (Escape would fire twice)",
  );
  const modal = s.slice(s.indexOf("{addOpen && ("));
  assert(
    /<Backdrop[\s\S]{0,900}onEscape=\{\(\) => !adding && setAddOpen\(false\)\}/
      .test(modal),
    "the New customer Backdrop closes on Escape unless the save is in flight",
  );
});

Deno.test("REQ-732 m26: a list inside a dialog keeps its Escape — SearchSelect and the subscription line search stop it only while something is open", () => {
  const ss = src("../islands/SearchSelect.tsx");
  assert(
    /e\.key === "Escape"\)\s*\{(\s*\/\/[^\n]*)*\s*if \(open\) e\.stopPropagation\(\);/
      .test(ss),
    "SearchSelect: an Escape that closes the open list must not also close the dialog",
  );
  const fs = src("../islands/FieldSubscriptionsPage.tsx");
  const combo = fs.slice(fs.indexOf("function onComboKey"));
  const esc = combo.slice(
    combo.indexOf('e.key === "Escape"'),
    combo.indexOf("function toggleDay"),
  );
  assert(
    /if \(form\.searchOn \|\| form\.options\.length\)\s*\{?\s*e\.stopPropagation\(\)/
      .test(esc),
    `the line search swallows every Escape, so Nueva suscripción never closes from it:\n${esc}`,
  );
});
