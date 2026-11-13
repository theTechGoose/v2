/**
 * REQ-638 (demo-loop cycle 5, M11) — an open native <select> list is shown on the stage.
 *
 * Chrome draws a native select's open list outside the DOM, so the mirror only ever carried the
 * select's value: the presenter saw a closed "Net 30" while the customer was choosing. Now the
 * recorder marks the select open (`data-mirror-open`) from the mousedown (or the keys) that open
 * it until a change, a blur, Escape/Enter/Tab, a mousedown elsewhere or the select leaving the
 * page; the stage's replay draws a static listbox of its options under it.
 *
 * End to end on the fake DOM: the customer's recorder → a JSON round trip → the stage's replayer.
 */
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  findAll,
  h,
} from "./support/fake-dom";

function record(doc: FDocument, out: MirrorFrame[]) {
  return createRecorder(doc as unknown as Document, {
    emit: (f) => out.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
  });
}

function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}

/** the customer's page: a Payment terms select (one option in a group), and a button */
function customerPage(selectAttrs: Record<string, string> = {}) {
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
          "label",
          {},
          "Payment terms",
          h(
            d,
            "select",
            { "data-cy": "terms", ...selectAttrs },
            h(d, "option", { value: "now" }, "Due now"),
            h(d, "option", { value: "net30", selected: "" }, "Net 30"),
            h(
              d,
              "optgroup",
              { label: "Longer" },
              h(d, "option", { value: "net60" }, "Net 60"),
            ),
          ),
        ),
        h(d, "button", { type: "button" }, "Save"),
      ),
    )
  );
}

/** a customer page, recorded, its snapshot replayed on a stage */
function setup(selectAttrs: Record<string, string> = {}) {
  const doc = customerPage(selectAttrs);
  const frames: MirrorFrame[] = [];
  const rec = record(doc, frames);
  rec.snapshot();
  const stage = stageDoc();
  const rep = createReplayer(stage as unknown as Document, {
    schedule: (fn) => fn(),
    Resize: null,
  });
  expect(rep.apply(frames[0])).toBe(true);
  let at = 1;
  const sel = find(doc, (e) => e.localName === "select")!;
  const btn = find(doc, (e) => e.localName === "button")!;
  /** the recorder's changes so far, applied on the stage */
  const sync = () => {
    rec.flush();
    for (; at < frames.length; at++) {
      expect(rep.apply(frames[at])).toBe(true);
    }
  };
  return { doc, rec, rep, stage, sel, btn, frames, sync };
}

/** the list the stage draws: null when none, else its rows */
function stageList(stage: FDocument) {
  const lists = findAll(stage, (e) => e.hasAttribute("data-mirror-listbox"));
  if (lists.length === 0) return null;
  expect(lists.length).toBe(1);
  const box = lists[0];
  return {
    box,
    role: box.getAttribute("role"),
    options: findAll(box, (e) => e.getAttribute("role") === "option").map((
      o,
    ) => ({
      text: o.textContent,
      selected: o.getAttribute("aria-selected") === "true",
    })),
    groups: findAll(box, (e) => e.hasAttribute("data-mirror-group")).map((g) =>
      g.textContent
    ),
  };
}

const stageSelect = (stage: FDocument) =>
  find(stage, (e) => e.localName === "select") as FElement;

describe("REQ-638 (cycle 5, M11) — an open native select is drawn on the stage", () => {
  test("a mousedown on the select opens the list on the stage: every option, the chosen one marked, its group named", () => {
    const { doc, sel, stage, sync } = setup();
    expect(stageList(stage)).toBeNull();
    doc.fire("mousedown", sel);
    sync();
    expect(stageSelect(stage).hasAttribute("data-mirror-open")).toBe(true);
    const list = stageList(stage);
    expect(list).not.toBeNull();
    expect(list!.role).toBe("listbox");
    expect(list!.options).toEqual([
      { text: "Due now", selected: false },
      { text: "Net 30", selected: true },
      { text: "Net 60", selected: false },
    ]);
    expect(list!.groups).toEqual(["Longer"]);
  });

  test("a pick (change) closes it, and the stage shows the new value", () => {
    const { doc, sel, stage, sync } = setup();
    doc.fire("mousedown", sel);
    sync();
    expect(stageList(stage)).not.toBeNull();
    sel.value = "net60";
    doc.fire("change", sel);
    sync();
    expect(stageList(stage)).toBeNull();
    expect(stageSelect(stage).hasAttribute("data-mirror-open")).toBe(false);
    expect(stageSelect(stage).value).toBe("net60");
  });

  test("Escape, a blur, a mousedown elsewhere, or a second mousedown on the select close it", () => {
    const { doc, sel, btn, stage, sync } = setup();
    const closesOn = (close: () => void) => {
      doc.fire("mousedown", sel);
      sync();
      expect(stageList(stage)).not.toBeNull();
      close();
      sync();
      expect(stageList(stage)).toBeNull();
    };
    closesOn(() => doc.fire("keydown", sel, { key: "Escape" }));
    closesOn(() => doc.fire("focusout", sel));
    closesOn(() => doc.fire("mousedown", btn));
    closesOn(() => doc.fire("mousedown", sel));
  });

  test("the keys that open a focused select open it on the stage too; Enter and Tab close it", () => {
    const { doc, sel, stage, sync } = setup();
    doc.fire("keydown", sel, { key: "ArrowDown", altKey: true });
    sync();
    expect(stageList(stage)).not.toBeNull();
    doc.fire("keydown", sel, { key: "Enter" });
    sync();
    expect(stageList(stage)).toBeNull();
    doc.fire("keydown", sel, { key: " " });
    sync();
    expect(stageList(stage)).not.toBeNull();
    doc.fire("keydown", sel, { key: "Tab" });
    sync();
    expect(stageList(stage)).toBeNull();
  });

  test("the chosen row follows the value while the list is open (arrow keys move it)", () => {
    const { doc, sel, stage, sync } = setup();
    doc.fire("mousedown", sel);
    sync();
    sel.value = "now";
    doc.fire("input", sel);
    sync();
    expect(stageList(stage)!.options.map((o) => o.selected)).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("a stage that joins while the list is open sees it open (the snapshot carries it)", () => {
    const { doc, sel, frames, rec } = setup();
    doc.fire("mousedown", sel);
    rec.flush();
    rec.snapshot();
    const snap = frames[frames.length - 1];
    expect(snap.t).toBe("snap");
    const late = stageDoc();
    const rep = createReplayer(late as unknown as Document, {
      schedule: (fn) => fn(),
      Resize: null,
    });
    expect(rep.apply(snap)).toBe(true);
    expect(stageList(late)).not.toBeNull();
  });

  test("the select leaving the page closes the list", () => {
    const { sel, stage, doc, sync } = setup();
    doc.fire("mousedown", sel);
    sync();
    expect(stageList(stage)).not.toBeNull();
    sel.parentNode!.removeChild(sel);
    sync();
    expect(stageList(stage)).toBeNull();
  });

  test("a list box (multiple, or size > 1) has no popup: nothing extra is drawn", () => {
    for (const attrs of [{ multiple: "" }, { size: "4" }]) {
      const { doc, sel, stage, sync } = setup(attrs);
      doc.fire("mousedown", sel);
      sync();
      expect(stageList(stage)).toBeNull();
    }
  });

  test("the page's own data-mirror-open never crosses: only the recorder says a select is open", () => {
    const { sel, stage, sync } = setup();
    sel.setAttribute("data-mirror-open", "");
    sync();
    expect(stageSelect(stage).hasAttribute("data-mirror-open")).toBe(false);
    expect(stageList(stage)).toBeNull();
  });

  test("a masked select's options are masked in the list too", () => {
    const { doc, sel, stage, sync } = setup({ "data-demo-mask": "" });
    doc.fire("mousedown", sel);
    sync();
    const texts = stageList(stage)!.options.map((o) => o.text);
    expect(texts).toEqual(["••• •••", "••• ••", "••• ••"]);
    expect(stageList(stage)!.groups.join("")).not.toContain("Longer");
  });

  test("the drawn list is the stage's own: never a mirrored node, nothing a pointer anchors to", () => {
    const { doc, sel, stage, rep, sync } = setup();
    doc.fire("mousedown", sel);
    sync();
    const { box } = stageList(stage)!;
    expect(box.getAttribute("style") ?? "").toMatch(/pointer-events:\s*none/);
    expect(box.getAttribute("aria-hidden")).toBe("true");
    for (let id = 1; id < 100; id++) expect(rep.nodeOf(id)).not.toBe(box);
  });
});
