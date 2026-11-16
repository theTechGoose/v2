/**
 * REQ-827 (demo-loop cycle dm2, s1) — an open native date picker or file chooser is shown on the
 * stage.
 *
 * Both are drawn by the customer's browser (or the OS) outside the DOM, so the stage showed
 * nothing while she chose a date or a file. The recorder marks the input `data-mirror-open`
 * (REQ-638's mark) while its picker is open; the stage's replay draws a chip under it.
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

const en: Record<string, string> = require("../../lang/en.json");
const es: Record<string, string> = require("../../lang/es.json");

function stageDoc(): FDocument {
  // big enough that the chip fits under its field (place() puts it above otherwise)
  const d = new FDocument("about:srcdoc", 1000, 1000);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}

/** the customer's page: a date-ish input, a hidden file input inside its label button, a
 *  visible file input, a text input and a button */
function customerPage(dateAttrs: Record<string, string>) {
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
        h(d, "input", { "data-cy": "when", ...dateAttrs }),
        h(
          d,
          "label",
          { "data-cy": "logo-btn" },
          "Upload logo",
          h(d, "input", { type: "file", hidden: "", "data-cy": "logo" }),
        ),
        h(d, "input", { type: "file", "data-cy": "doc" }),
        h(d, "input", { type: "text", "data-cy": "name" }),
        h(d, "button", { type: "button" }, "Save"),
      ),
    )
  );
}

const CYS = ["when", "logo-btn", "logo", "doc", "name"];

function setup(
  dateAttrs: Record<string, string> = { type: "date" },
  pickerLabel?: (k: "date" | "file") => string,
) {
  const doc = customerPage(dateAttrs);
  const by = (cy: string) =>
    find(doc, (e) => e.getAttribute("data-cy") === cy)!;
  by("when").rect = { left: 10, top: 20, width: 160, height: 30 };
  by("logo-btn").rect = { left: 10, top: 100, width: 120, height: 36 };
  by("doc").rect = { left: 10, top: 200, width: 250, height: 30 };
  by("name").rect = { left: 10, top: 300, width: 200, height: 30 };
  const frames: MirrorFrame[] = [];
  const rec = createRecorder(doc as unknown as Document, {
    emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
  });
  const stage = stageDoc();
  /** the stage's copies of the page's elements keep their boxes (the fake DOM has no layout) */
  const boxes = (d: FDocument) => {
    for (const cy of CYS) {
      const s = find(d, (e) => e.getAttribute("data-cy") === cy);
      const c = find(doc, (e) => e.getAttribute("data-cy") === cy);
      if (s && c) s.rect = { ...c.rect };
    }
  };
  const rep = createReplayer(stage as unknown as Document, {
    schedule: (fn) => fn(),
    Resize: null,
    ...(pickerLabel ? { pickerLabel } : {}),
  });
  rec.snapshot();
  expect(rep.apply(frames[0])).toBe(true);
  boxes(stage);
  let at = 1;
  const sync = () => {
    rec.flush();
    for (; at < frames.length; at++) {
      expect(rep.apply(frames[at])).toBe(true);
      boxes(stage);
    }
    // the chip is drawn after every frame: one more (empty) frame draws it on the boxes just set
    expect(rep.apply({ t: "ops", ops: [] } as unknown as MirrorFrame)).toBe(
      true,
    );
  };
  const btn = find(doc, (e) => e.localName === "button")!;
  const win = (doc as unknown as { defaultView: { fire(t: string): void } })
    .defaultView;
  return { doc, rec, rep, stage, by, btn, win, frames, sync, boxes };
}

/** the chip the stage draws: null when none */
function chip(stage: FDocument) {
  const all = findAll(stage, (e) => e.hasAttribute("data-mirror-picker"));
  if (all.length === 0) return null;
  expect(all.length).toBe(1);
  const c = all[0];
  return {
    el: c,
    kind: c.getAttribute("data-mirror-picker"),
    text: c.textContent,
    style: c.getAttribute("style") ?? "",
  };
}

const stageEl = (stage: FDocument, cy: string) =>
  find(stage, (e) => e.getAttribute("data-cy") === cy) as FElement;

describe("REQ-827 (cycle dm2, s1) — an open date picker is shown on the stage", () => {
  test("a mousedown on a date input marks it open and the stage draws a 'Choosing a date…' chip under it", () => {
    const { doc, by, stage, sync } = setup();
    expect(chip(stage)).toBeNull();
    doc.fire("mousedown", by("when"));
    sync();
    expect(stageEl(stage, "when").hasAttribute("data-mirror-open")).toBe(true);
    const c = chip(stage);
    expect(c).not.toBeNull();
    expect(c!.kind).toBe("date");
    expect(c!.text).toBe("Choosing a date…");
    expect(c!.style).toMatch(/left:10px;top:50px;/);
    expect(c!.style).toMatch(/pointer-events:\s*none/);
    expect(c!.el.getAttribute("aria-hidden")).toBe("true");
    // never a select's list
    expect(findAll(stage, (e) => e.hasAttribute("data-mirror-listbox")).length)
      .toBe(0);
  });

  test("a click that reaches it (a label click, a page's showPicker() on click) opens it too", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("click", by("when"));
    sync();
    expect(chip(stage)?.kind).toBe("date");
  });

  test("a mousedown then its click keep it open (no toggle)", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("when"));
    doc.fire("click", by("when"));
    sync();
    expect(chip(stage)?.kind).toBe("date");
  });

  test("a pick (change), a blur, Escape or a mousedown elsewhere closes it", () => {
    const { doc, by, btn, stage, sync } = setup();
    const closesOn = (close: () => void) => {
      doc.fire("mousedown", by("when"));
      sync();
      expect(chip(stage)).not.toBeNull();
      close();
      sync();
      expect(chip(stage)).toBeNull();
      expect(stageEl(stage, "when").hasAttribute("data-mirror-open")).toBe(
        false,
      );
    };
    closesOn(() => {
      by("when").value = "2026-12-01";
      doc.fire("change", by("when"));
    });
    closesOn(() => doc.fire("focusout", by("when")));
    closesOn(() => doc.fire("keydown", by("when"), { key: "Escape" }));
    closesOn(() => doc.fire("mousedown", btn));
  });

  test("F4 or Alt+ArrowDown on a focused date input opens it", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("keydown", by("when"), { key: "F4" });
    sync();
    expect(chip(stage)?.kind).toBe("date");
    doc.fire("keydown", by("when"), { key: "Escape" });
    sync();
    expect(chip(stage)).toBeNull();
    doc.fire("keydown", by("when"), { key: "ArrowDown", altKey: true });
    sync();
    expect(chip(stage)?.kind).toBe("date");
  });

  test("time, datetime-local, month and week inputs open the chip too", () => {
    for (const type of ["time", "datetime-local", "month", "week"]) {
      const { doc, by, stage, sync } = setup({ type });
      doc.fire("mousedown", by("when"));
      sync();
      expect(chip(stage)?.kind).toBe("date");
    }
  });

  test("a disabled or readonly date input, or a text input, never opens anything", () => {
    for (const attrs of [{ disabled: "" }, { readonly: "" }]) {
      const { doc, by, stage, sync } = setup({ type: "date", ...attrs });
      doc.fire("mousedown", by("when"));
      doc.fire("click", by("when"));
      sync();
      expect(chip(stage)).toBeNull();
    }
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("name"));
    doc.fire("click", by("name"));
    sync();
    expect(chip(stage)).toBeNull();
  });

  test("the input leaving the page closes it", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("when"));
    sync();
    expect(chip(stage)).not.toBeNull();
    const w = by("when");
    w.parentNode!.removeChild(w);
    sync();
    expect(chip(stage)).toBeNull();
  });

  test("a stage that joins while it is open sees the chip (the snapshot carries the mark)", () => {
    const { doc, by, frames, rec, boxes } = setup();
    doc.fire("mousedown", by("when"));
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
    boxes(late);
    expect(rep.apply({ t: "ops", ops: [] } as unknown as MirrorFrame)).toBe(
      true,
    );
    expect(chip(late)?.kind).toBe("date");
  });

  test("the page's own data-mirror-open never crosses", () => {
    const { by, stage, sync } = setup();
    by("when").setAttribute("data-mirror-open", "");
    sync();
    expect(stageEl(stage, "when").hasAttribute("data-mirror-open")).toBe(false);
    expect(chip(stage)).toBeNull();
  });
});

describe("REQ-827 (cycle dm2, s1) — an open file chooser is shown on the stage", () => {
  test("a click on a file input marks it open and the stage draws 'Customer is choosing a file…' under it", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("doc"));
    doc.fire("click", by("doc"));
    sync();
    expect(stageEl(stage, "doc").hasAttribute("data-mirror-open")).toBe(true);
    const c = chip(stage);
    expect(c?.kind).toBe("file");
    expect(c?.text).toBe("Customer is choosing a file…");
    expect(c!.style).toMatch(/left:10px;top:230px;/);
  });

  test("a hidden file input opened from its label: the chip sits under the label (the nearest box)", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("logo-btn"));
    doc.fire("click", by("logo-btn"));
    doc.fire("click", by("logo")); // the label forwards its click to the input
    sync();
    const c = chip(stage);
    expect(c?.kind).toBe("file");
    expect(c!.style).toMatch(/left:10px;top:136px;/);
  });

  test("a chosen file (change), a cancel, the window's focus coming back or a mousedown elsewhere closes it", () => {
    const { doc, by, btn, win, stage, sync } = setup();
    const closesOn = (close: () => void) => {
      doc.fire("click", by("doc"));
      sync();
      expect(chip(stage)?.kind).toBe("file");
      close();
      sync();
      expect(chip(stage)).toBeNull();
    };
    closesOn(() => doc.fire("change", by("doc")));
    closesOn(() => doc.fire("cancel", by("doc")));
    closesOn(() => win.fire("focus"));
    closesOn(() => doc.fire("mousedown", btn));
  });

  test("the blur the open dialog itself causes does not close it", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("click", by("doc"));
    doc.fire("focusout", by("doc"));
    sync();
    expect(chip(stage)?.kind).toBe("file");
  });

  test("a disabled file input never opens", () => {
    const { doc, by, stage, sync } = setup();
    by("doc").setAttribute("disabled", "");
    sync();
    doc.fire("click", by("doc"));
    sync();
    expect(chip(stage)).toBeNull();
  });
});

describe("REQ-827 (cycle dm2, s1) — the chip speaks the presenter's language", () => {
  test("the replayer's pickerLabel names the chip", () => {
    const { doc, by, stage, sync } = setup(
      { type: "date" },
      (k) => (k === "date" ? "Eligiendo una fecha…" : "Eligiendo un archivo…"),
    );
    doc.fire("mousedown", by("when"));
    sync();
    expect(chip(stage)?.text).toBe("Eligiendo una fecha…");
    doc.fire("mousedown", by("doc"));
    doc.fire("click", by("doc"));
    sync();
    expect(chip(stage)?.text).toBe("Eligiendo un archivo…");
  });

  test("demoMode.pickerDate / demoMode.pickerFile exist in en and es, and DemoStage passes them", () => {
    expect(en["demoMode.pickerDate"]).toBe("Choosing a date…");
    expect(en["demoMode.pickerFile"]).toBe("Customer is choosing a file…");
    expect(es["demoMode.pickerDate"]).toBeTruthy();
    expect(es["demoMode.pickerFile"]).toBeTruthy();
    const src: string = require("fs").readFileSync(
      require("path").join(__dirname, "../../front-end/islands/DemoStage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/pickerLabel[\s\S]{0,200}demoMode\.picker(Date|File)/);
  });
});
