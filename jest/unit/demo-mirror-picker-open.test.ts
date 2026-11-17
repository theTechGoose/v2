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
  test("a mousedown on a date input marks it open and the stage draws a 'Choosing a date…' chip on it (REQ-862: in its row, not under it)", () => {
    const { doc, by, stage, sync } = setup();
    expect(chip(stage)).toBeNull();
    doc.fire("mousedown", by("when"));
    sync();
    expect(stageEl(stage, "when").hasAttribute("data-mirror-open")).toBe(true);
    const c = chip(stage);
    expect(c).not.toBeNull();
    expect(c!.kind).toBe("date");
    expect(c!.text).toBe("Choosing a date…");
    // REQ-862 AMENDMENT (dm8, m1): beside the 160×30 input at (10,20), right edge + 8 — never ON
    // an input (no layout: the chip is estimated 140×26)
    expect(c!.style).toMatch(/left:178px;top:22px;/);
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
  test("a click on a file input marks it open and the stage draws 'Customer is choosing a file…' on it (REQ-862: in its row)", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("doc"));
    doc.fire("click", by("doc"));
    sync();
    expect(stageEl(stage, "doc").hasAttribute("data-mirror-open")).toBe(true);
    const c = chip(stage);
    expect(c?.kind).toBe("file");
    expect(c?.text).toBe("Customer is choosing a file…");
    // REQ-862 AMENDMENT (dm8, m1): beside the 250×30 input at (10,200), right edge + 8 (the chip
    // estimated 230×26) — never on it
    expect(c!.style).toMatch(/left:268px;top:202px;/);
  });

  test("a hidden file input opened from its label: the chip sits by the label (the nearest box; REQ-862: beside it, in its row)", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("logo-btn"));
    doc.fire("click", by("logo-btn"));
    doc.fire("click", by("logo")); // the label forwards its click to the input
    sync();
    const c = chip(stage);
    expect(c?.kind).toBe("file");
    // REQ-862: wider than the 120 px label, so beside it: right edge + 8 px
    expect(c!.style).toMatch(/left:138px;top:105px;/);
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

/**
 * REQ-862 (demo-loop cycle dm4, issue p7) — the chip never covers frame text the customer can
 * read, and is set in the app's font.
 *
 * REQ-827 hung the chip under its field (place(): top = the control's bottom + a 4 px margin), so
 * it sat over whatever was next: the "November 16, 2026" helper under "Received on", the
 * "APP LANGUAGE" label under "Upload logo". Its CHIP_CSS hard-coded
 * `font:600 13px/1.4 system-ui,…`, a family the app uses nowhere (monospace-looking on headless
 * Linux). Now the chip sits on the control's own box when it fits there, else beside it
 * (right edge + 8 px, else left edge − 8 px), else centred on the control; always in the
 * control's own row; in the frame's body font (Inter by default).
 */
describe("REQ-862 (cycle dm4, p7) — the picker chip covers no frame text and uses the app font", () => {
  const W: Record<string, number> = {
    "Choosing a date…": 140,
    "Customer is choosing a file…": 238,
  };
  let spy: jest.SpyInstance;
  beforeEach(() => {
    // the fake DOM has no layout: the chip gets the size Chromium gave it in the demo
    const orig = FElement.prototype.getBoundingClientRect;
    spy = jest.spyOn(FElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: FElement) {
        if (this.hasAttribute("data-mirror-picker")) {
          const w = W[this.textContent ?? ""] ?? 200;
          return {
            left: 0,
            top: 0,
            width: w,
            height: 26,
            x: 0,
            y: 0,
            right: w,
            bottom: 26,
          };
        }
        return orig.call(this);
      });
  });
  afterEach(() => spy.mockRestore());

  /** the chip's box from its style (left/top) and its size */
  const box = (c: NonNullable<ReturnType<typeof chip>>) => {
    const left = Number(/left:(-?[\d.]+)px/.exec(c.style)![1]);
    const top = Number(/top:(-?[\d.]+)px/.exec(c.style)![1]);
    const w = W[c.text ?? ""] ?? 200;
    return { left, top, right: left + w, bottom: top + 26 };
  };
  const overlaps = (
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; width: number; height: number },
  ) =>
    a.left < b.left + b.width && b.left < a.right &&
    a.top < b.top + b.height && b.top < a.bottom;

  test("a date chip that fits sits BESIDE the date input (REQ-862 AMENDMENT, dm8 m1: never on an input — it hides the value) — never under it on the next line", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("when"));
    sync();
    const c = chip(stage)!;
    const b = box(c);
    const r = by("when").rect; // 10,20 160×30 — the chip at its right edge + 8, in its row
    expect(c.style).toMatch(/left:178px;top:22px;/);
    expect(overlaps(b, { ...r })).toBe(false);
    expect(b.top).toBeGreaterThanOrEqual(r.top);
    expect(b.bottom).toBeLessThanOrEqual(r.top + r.height);
    expect(c.style).not.toMatch(/margin:4px/);
    // the helper line right under the input stays readable
    expect(overlaps(b, { left: 10, top: 52, width: 300, height: 18 })).toBe(
      false,
    );
  });

  test("a file chip wider than its upload button sits beside it (right edge + 8 px), in its row — not over the next label", () => {
    const { doc, by, stage, sync } = setup();
    doc.fire("mousedown", by("logo-btn"));
    doc.fire("click", by("logo-btn"));
    doc.fire("click", by("logo"));
    sync();
    const c = chip(stage)!;
    const b = box(c);
    expect(c.style).toMatch(/left:138px;top:105px;/);
    // "APP LANGUAGE" right under the button
    expect(overlaps(b, { left: 10, top: 146, width: 120, height: 18 })).toBe(
      false,
    );
    for (const cy of ["when", "logo-btn", "doc", "name"]) {
      expect(overlaps(b, by(cy).rect)).toBe(false);
    }
  });

  test("no room on the right: beside its left edge (left edge − 8 px)", () => {
    const { doc, by, stage, sync, boxes } = setup();
    by("logo-btn").rect = { left: 800, top: 100, width: 120, height: 36 };
    boxes(stage);
    doc.fire("mousedown", by("logo-btn"));
    doc.fire("click", by("logo-btn"));
    doc.fire("click", by("logo"));
    sync();
    expect(chip(stage)!.style).toMatch(/left:554px;top:105px;/);
  });

  test("no room on the control, on either side, under or over it: under the control (REQ-862 AMENDMENT 2, dm9 m2/m3 — never on it, which hid the value or the label), kept inside the frame", () => {
    const { doc, by, stage, sync, boxes } = setup();
    // a 200 px button in a 300 px frame: the 238 px chip fits neither on it nor beside it
    by("logo-btn").rect = { left: 10, top: 100, width: 200, height: 36 };
    // REQ-878 (dm5 p2): fields right over and under it, so no spot is free of the page's text
    by("when").rect = { left: 10, top: 66, width: 160, height: 30 };
    by("doc").rect = { left: 10, top: 140, width: 250, height: 30 };
    stage.defaultView.innerWidth = 300;
    boxes(stage);
    doc.fire("mousedown", by("logo-btn"));
    doc.fire("click", by("logo-btn"));
    doc.fire("click", by("logo"));
    sync();
    // REQ-862 AMENDMENT 2 put it under the button (its top + height + 4) — ON the next field's
    // input there; REQ-862 AMENDMENT 3 (dm10, m1) — the nearest clear band instead: one chip's
    // height plus the gap further, under that field, at the button's left edge. REQ-862
    // AMENDMENT 4 (dm11, m1) — a 238 px chip on a 300 px frame wraps inside 150 px (two lines,
    // 44.2 px tall), so that band is one such chip plus the gap under the button
    expect(chip(stage)!.style).toMatch(/max-width:150px;white-space:normal;/);
    expect(chip(stage)!.style).toMatch(/left:10px;top:188.2px;/);
  });

  test("the chip is set in the app's font: the frame body's family, Inter when it has none — never the system-ui stack", () => {
    const a = setup();
    a.doc.fire("mousedown", a.by("when"));
    a.sync();
    const plain = chip(a.stage)!.style;
    expect(plain).not.toMatch(/system-ui,-apple-system,sans-serif/);
    expect(plain).toMatch(/font-family:\s*"?Inter"?,/);
    expect(plain).toMatch(/font-weight:\s*600/);
    expect(plain).toMatch(/font-size:\s*13px/);

    const b = setup();
    (b.stage.defaultView as unknown as {
      getComputedStyle: (e: unknown) => { fontFamily: string };
    }).getComputedStyle = (e) => ({
      fontFamily: e === b.stage.body ? '"Nunito", sans-serif' : "serif",
    });
    b.doc.fire("mousedown", b.by("when"));
    b.sync();
    expect(chip(b.stage)!.style).toMatch(
      /font-family:\s*"Nunito", sans-serif;/,
    );
  });
});

/**
 * REQ-878 (demo-loop cycle dm5, issue p2) — the file chip sits by the control the customer used,
 * never over the row's hint or the button's label.
 *
 * /settings (front-end/islands/SettingsPage.tsx) opens its file inputs from a SIBLING button:
 * `<div style="display:flex;gap:12px">` holds `<button>Upload logo</button>`, a
 * `<input type=file style="display:none">` and a hint `<span>`. REQ-827's chipAnchor walked up to
 * the first ancestor with a box, which is that full-width row, and REQ-862's placeChip centred
 * the chip on it, over the hint (demo: button 271–379, hint 391–800, chip 653–855) or over
 * "Subir certificado" and its hint. REQ-862's tests only had the input INSIDE its label button.
 */
describe("REQ-878 (cycle dm5, p2) — the file chip by a sibling upload button covers neither the hint nor the button", () => {
  const CHIP_W = 203; // the chip Chromium drew in the demo (Inter 13px 600)
  let spy: jest.SpyInstance;
  beforeEach(() => {
    const orig = FElement.prototype.getBoundingClientRect;
    spy = jest.spyOn(FElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: FElement) {
        if (this.hasAttribute("data-mirror-picker")) {
          return {
            left: 0,
            top: 0,
            width: CHIP_W,
            height: 26,
            x: 0,
            y: 0,
            right: CHIP_W,
            bottom: 26,
          };
        }
        return orig.call(this);
      });
  });
  afterEach(() => spy.mockRestore());

  type R = { left: number; top: number; width: number; height: number };
  /** SettingsPage's logo row and its insurance-certificate row, with the demo's boxes */
  function settings(rows: Record<string, R>) {
    const doc = docWith(
      (d) =>
        h(
          d,
          "html",
          {},
          h(d, "head"),
          h(
            d,
            "body",
            {},
            h(d, "p", { "data-cy": "left-col" }, "Business name and address"),
            h(
              d,
              "div",
              {
                id: "logo",
                "data-cy": "logo-row",
                style:
                  "grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:12px",
              },
              h(
                d,
                "button",
                { type: "button", "data-cy": "logo-btn" },
                "Subir logo",
              ),
              h(d, "input", {
                type: "file",
                "data-cy": "settings-logo-file",
                style: "display:none",
              }),
              h(
                d,
                "span",
                { "data-cy": "settings-logo-hint" },
                "PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas",
              ),
            ),
            h(
              d,
              "div",
              {
                "data-cy": "settings-insurance-upload",
                style:
                  "margin-top:14px;display:flex;align-items:center;gap:12px",
              },
              h(
                d,
                "button",
                { type: "button", "data-cy": "cert-btn" },
                "Subir certificado",
              ),
              h(d, "input", {
                type: "file",
                "data-cy": "cert-file",
                style: "display:none",
              }),
              h(
                d,
                "span",
                { "data-cy": "cert-hint" },
                "PDF o imagen · prueba de seguro / responsabilidad civil",
              ),
            ),
          ),
        ),
      "https://app.test/settings",
      1280,
      800,
    );
    const cys = Object.keys(rows);
    const by = (cy: string) =>
      find(doc, (e) => e.getAttribute("data-cy") === cy)!;
    for (const cy of cys) by(cy).rect = { ...rows[cy] };
    const frames: MirrorFrame[] = [];
    const rec = createRecorder(doc as unknown as Document, {
      emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
      Observer: FakeMutationObserver as unknown as typeof MutationObserver,
      manual: true,
    });
    const stage = new FDocument("about:srcdoc", 1280, 800);
    stage.appendChild(h(stage, "html", {}, h(stage, "head"), h(stage, "body")));
    const boxes = () => {
      for (const cy of cys) {
        const s = find(stage, (e) => e.getAttribute("data-cy") === cy);
        if (s) s.rect = { ...rows[cy] };
      }
    };
    const rep = createReplayer(stage as unknown as Document, {
      schedule: (fn) => fn(),
      Resize: null,
    });
    rec.snapshot();
    expect(rep.apply(frames[0])).toBe(true);
    boxes();
    let at = 1;
    /** the customer clicks `btn`; the page's onClick calls `input.click()` */
    const open = (btn: string, input: string) => {
      doc.fire("mousedown", by(btn));
      doc.fire("click", by(btn));
      doc.fire("click", by(input));
      rec.flush();
      for (; at < frames.length; at++) {
        expect(rep.apply(frames[at])).toBe(true);
        boxes();
      }
      expect(rep.apply({ t: "ops", ops: [] } as unknown as MirrorFrame))
        .toBe(true);
      const c = chip(stage)!;
      expect(c?.kind).toBe("file");
      const left = Number(/left:(-?[\d.]+)px/.exec(c.style)![1]);
      const top = Number(/top:(-?[\d.]+)px/.exec(c.style)![1]);
      return { left, top, width: CHIP_W, height: 26, text: c.text ?? "" };
    };
    return { open };
  }
  const hits = (a: R, b: R) =>
    a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height;

  test("logo: button 271–379 and hint 391–800 in a 271–1236 row — the chip is in the row, clear of the hint and the button (not centred on the row at 652.5)", () => {
    const rows = {
      "logo-row": { left: 271, top: 407, width: 965, height: 43 },
      "logo-btn": { left: 271, top: 407, width: 108, height: 43 },
      "settings-logo-hint": { left: 391, top: 421, width: 409, height: 15 },
    };
    const c = settings(rows).open("logo-btn", "settings-logo-file");
    expect(c.left).not.toBe(271 + (965 - CHIP_W) / 2); // the bug: centred on the row
    expect(hits(c, rows["settings-logo-hint"])).toBe(false);
    expect(hits(c, rows["logo-btn"])).toBe(false);
    // still in the button's row: vertically centred on it, inside the row's span
    expect(c.top + 13).toBeCloseTo(407 + 43 / 2, 0);
    expect(c.left).toBeGreaterThanOrEqual(271);
    expect(c.left + CHIP_W).toBeLessThanOrEqual(1236);
    // REQ-878 AMENDMENT (dm8, m3) — past the hint, 370 px from its button, the chip names it
    expect(c.text).toBe("Customer is choosing a file… · Subir logo");
  });

  test("REQ-878 AMENDMENT (dm8, m3): a chip right beside its control carries no name", () => {
    const rows = {
      "logo-row": { left: 271, top: 407, width: 965, height: 43 },
      "logo-btn": { left: 271, top: 407, width: 108, height: 43 },
      "settings-logo-hint": { left: 700, top: 421, width: 300, height: 15 },
    };
    const c = settings(rows).open("logo-btn", "settings-logo-file");
    expect(c.left).toBe(271 + 108 + 8);
    expect(c.text).toBe("Customer is choosing a file…");
  });

  test("certificate: a narrow card row whose hint runs to the frame's edge — the chip covers neither 'Subir certificado' nor the hint nor the text to its left", () => {
    const rows = {
      "left-col": { left: 300, top: 410, width: 560, height: 30 },
      "settings-insurance-upload": {
        left: 876,
        top: 407,
        width: 380,
        height: 43,
      },
      "cert-btn": { left: 876, top: 407, width: 140, height: 43 },
      "cert-hint": { left: 1028, top: 407, width: 228, height: 43 },
    };
    const c = settings(rows).open("cert-btn", "cert-file");
    expect(hits(c, rows["cert-btn"])).toBe(false);
    expect(hits(c, rows["cert-hint"])).toBe(false);
    expect(hits(c, rows["left-col"])).toBe(false);
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.left + CHIP_W).toBeLessThanOrEqual(1280);
  });
});

describe("REQ-862 AMENDMENT 2 / REQ-878 AMENDMENT 2 (demo-loop run 9: m1–m4, p3) — a chip never on an input or over a picture; an input is named by its label; the name is what the customer reads", () => {
  const DATE_W = 156; // "Choosing a date…" as Chromium drew it at 1280 and 390
  const FILE_W = 203;
  let spy: jest.SpyInstance;
  beforeEach(() => {
    const orig = FElement.prototype.getBoundingClientRect;
    spy = jest.spyOn(FElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: FElement) {
        if (this.hasAttribute("data-mirror-picker")) {
          const text = this.textContent ?? "";
          const base = text.startsWith("Choosing a date") ? DATE_W : FILE_W;
          const name = text.includes(" · ") ? text.split(" · ")[1] : "";
          const w = base + (name ? name.length * 7.5 + 12 : 0);
          return {
            left: 0,
            top: 0,
            width: w,
            height: 26,
            x: 0,
            y: 0,
            right: w,
            bottom: 26,
          };
        }
        return orig.call(this);
      });
  });
  afterEach(() => spy.mockRestore());

  type R = { left: number; top: number; width: number; height: number };
  const hits = (a: R, b: R) =>
    a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height;

  /** a page built by `body`, every data-cy element given the demo's box; the chip the stage draws
   *  once the customer's click on the picker's control has gone over */
  function page(
    body: (d: FDocument) => FElement,
    rows: Record<string, R>,
    view: { w: number; h: number },
  ) {
    const doc = docWith(
      (d) => h(d, "html", {}, h(d, "head"), body(d)),
      "https://app.test/x",
      view.w,
      view.h,
    );
    const cys = Object.keys(rows);
    const by = (cy: string) =>
      find(doc, (e) => e.getAttribute("data-cy") === cy)!;
    for (const cy of cys) by(cy).rect = { ...rows[cy] };
    const frames: MirrorFrame[] = [];
    const rec = createRecorder(doc as unknown as Document, {
      emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
      Observer: FakeMutationObserver as unknown as typeof MutationObserver,
      manual: true,
    });
    const stage = new FDocument("about:srcdoc", view.w, view.h);
    stage.appendChild(
      h(stage, "html", {}, h(stage, "head"), h(stage, "body")),
    );
    const boxes = () => {
      for (const cy of cys) {
        const s = find(stage, (e) => e.getAttribute("data-cy") === cy);
        if (s) s.rect = { ...rows[cy] };
      }
    };
    const rep = createReplayer(stage as unknown as Document, {
      schedule: (fn) => fn(),
      Resize: null,
    });
    rec.snapshot();
    expect(rep.apply(frames[0])).toBe(true);
    boxes();
    let at = 1;
    const drawn = (w: number) => {
      rec.flush();
      for (; at < frames.length; at++) {
        expect(rep.apply(frames[at])).toBe(true);
        boxes();
      }
      expect(rep.apply({ t: "ops", ops: [] } as unknown as MirrorFrame)).toBe(
        true,
      );
      const c = chip(stage)!;
      const left = Number(/left:(-?[\d.]+)px/.exec(c.style)![1]);
      const top = Number(/top:(-?[\d.]+)px/.exec(c.style)![1]);
      const text = c.text ?? "";
      const name = text.includes(" · ") ? text.split(" · ")[1] : "";
      return {
        left,
        top,
        width: w + (name ? name.length * 7.5 + 12 : 0),
        height: 26,
        text,
      };
    };
    return {
      date: (cy: string) => {
        doc.fire("mousedown", by(cy));
        return drawn(DATE_W);
      },
      file: (btn: string, input: string) => {
        doc.fire("mousedown", by(btn));
        doc.fire("click", by(btn));
        doc.fire("click", by(input));
        return drawn(FILE_W);
      },
    };
  }

  test("m2: at 390 px a date input spans the row — the chip goes over it, right of its label, never on it", () => {
    const rows = {
      "vence-label": { left: 43, top: 380, width: 57, height: 15 },
      vence: { left: 43, top: 402, width: 304, height: 41 },
      "vence-hint": { left: 43, top: 447, width: 304, height: 15 },
    };
    const c = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(
            d,
            "div",
            { "data-cy": "card" },
            h(d, "label", { "data-cy": "vence-label", for: "vence" }, "VENCE"),
            h(d, "input", { type: "date", id: "vence", "data-cy": "vence" }),
            h(
              d,
              "p",
              { "data-cy": "vence-hint" },
              "Fecha en que vence el seguro",
            ),
          ),
        ),
      rows,
      { w: 390, h: 844 },
    ).date("vence");
    expect(hits(c, rows.vence)).toBe(false);
    expect(hits(c, rows["vence-label"])).toBe(false);
    expect(hits(c, rows["vence-hint"])).toBe(false);
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.left + c.width).toBeLessThanOrEqual(390);
  });

  test("m1 / p3: a date field with a twin at its right (From / To) — the chip never lands beside the other field unnamed; an input is named by its <label>", () => {
    const rows = {
      "range-row": { left: 273, top: 690, width: 354, height: 63 },
      "from-label": { left: 273, top: 690, width: 170, height: 15 },
      from: { left: 273, top: 707, width: 170, height: 46 },
      "to-label": { left: 457, top: 690, width: 170, height: 15 },
      to: { left: 457, top: 707, width: 170, height: 46 },
      "left-text": { left: 40, top: 707, width: 225, height: 46 },
      "under-text": { left: 273, top: 757, width: 354, height: 15 },
    };
    const c = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(d, "p", { "data-cy": "left-text" }, "Custom range: pick the dates"),
          h(
            d,
            "div",
            { "data-cy": "range-row" },
            h(d, "label", { "data-cy": "from-label", for: "from" }, "From"),
            h(d, "input", { type: "date", id: "from", "data-cy": "from" }),
            h(d, "label", { "data-cy": "to-label", for: "to" }, "To"),
            h(d, "input", { type: "date", id: "to", "data-cy": "to" }),
          ),
          h(
            d,
            "p",
            { "data-cy": "under-text" },
            "Reports cover the days you pick",
          ),
        ),
      rows,
      { w: 1280, h: 800 },
    ).date("from");
    expect(hits(c, rows.from)).toBe(false);
    expect(hits(c, rows.to)).toBe(false);
    // not beside From (the row is full): it says which field
    const besideFrom = c.top < rows.from.top + rows.from.height &&
      rows.from.top < c.top + c.height &&
      c.left <= rows.from.left + rows.from.width + 9 &&
      c.left + c.width >= rows.from.left - 9;
    const underOrOver = c.left < rows.from.left + rows.from.width &&
      rows.from.left < c.left + c.width &&
      (Math.abs(c.top - (rows.from.top + rows.from.height)) <= 5 ||
        Math.abs(c.top + c.height - rows.from.top) <= 5);
    if (!besideFrom && !underOrOver) {
      expect(c.text).toBe("Choosing a date… · From");
    }
  });

  test("m3: at 390 px a file chip wider than its button goes under or over the button, never on it or past the frame's edge", () => {
    const rows = {
      "logo-row": { left: 43, top: 399, width: 304, height: 81 },
      "logo-btn": { left: 43, top: 399, width: 108, height: 43 },
      "logo-hint": { left: 43, top: 450, width: 304, height: 30 },
    };
    const c = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(
            d,
            "div",
            { "data-cy": "logo-row" },
            h(
              d,
              "button",
              { type: "button", "data-cy": "logo-btn" },
              "Subir logo",
            ),
            h(d, "input", {
              type: "file",
              "data-cy": "logo-file",
              style: "display:none",
            }),
            h(
              d,
              "span",
              { "data-cy": "logo-hint" },
              "PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas",
            ),
          ),
        ),
      rows,
      { w: 390, h: 844 },
    ).file("logo-btn", "logo-file");
    expect(hits(c, rows["logo-btn"])).toBe(false);
    expect(hits(c, rows["logo-hint"])).toBe(false);
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.left + c.width).toBeLessThanOrEqual(390);
  });

  test("m4: after an upload the button reads 'Reemplazar logo' (its aria-label still 'Subir logo') and a thumbnail sits at its right — the chip covers neither the picture nor the hint, and names what the customer reads", () => {
    const rows = {
      "logo-row": { left: 271, top: 407, width: 965, height: 43 },
      "logo-btn": { left: 271, top: 407, width: 130, height: 43 },
      "logo-img": { left: 413, top: 411, width: 96, height: 32 },
      "logo-set": { left: 517, top: 421, width: 80, height: 15 },
      "logo-hint": { left: 609, top: 421, width: 409, height: 15 },
    };
    const c = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(
            d,
            "div",
            { "data-cy": "logo-row" },
            h(
              d,
              "button",
              {
                type: "button",
                "data-cy": "logo-btn",
                "aria-label": "Subir logo",
              },
              "Reemplazar logo",
            ),
            h(d, "input", {
              type: "file",
              "data-cy": "logo-file",
              style: "display:none",
            }),
            h(
              d,
              "span",
              {},
              h(d, "img", {
                "data-cy": "logo-img",
                src: "/api/files/x",
                alt: "Logo cargado",
              }),
              h(d, "span", { "data-cy": "logo-set" }, "Logo cargado"),
            ),
            h(
              d,
              "span",
              { "data-cy": "logo-hint" },
              "PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas",
            ),
          ),
        ),
      rows,
      { w: 1280, h: 800 },
    ).file("logo-btn", "logo-file");
    expect(hits(c, rows["logo-img"])).toBe(false);
    expect(hits(c, rows["logo-hint"])).toBe(false);
    expect(hits(c, rows["logo-btn"])).toBe(false);
    expect(c.text).toBe("Customer is choosing a file… · Reemplazar logo");
  });
});

describe("REQ-862 AMENDMENT 3 / REQ-878 AMENDMENT 3 (demo-loop run 10: m1, m5) — a chip with no clear spot by its control takes the nearest clear band (named); text hidden behind a dialog's backdrop does not push it; a chip narrower than its field stays within the field's span", () => {
  const DATE_W = 156;
  const FILE_W = 203;
  let spy: jest.SpyInstance;
  beforeEach(() => {
    const orig = FElement.prototype.getBoundingClientRect;
    spy = jest.spyOn(FElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: FElement) {
        if (this.hasAttribute("data-mirror-picker")) {
          const text = this.textContent ?? "";
          const base = text.startsWith("Choosing a date") ? DATE_W : FILE_W;
          const name = text.includes(" · ") ? text.split(" · ")[1] : "";
          const w = base + (name ? name.length * 7.5 + 12 : 0);
          return {
            left: 0,
            top: 0,
            width: w,
            height: 26,
            x: 0,
            y: 0,
            right: w,
            bottom: 26,
          };
        }
        return orig.call(this);
      });
  });
  afterEach(() => spy.mockRestore());

  type R = { left: number; top: number; width: number; height: number };
  const hits = (a: R, b: R) =>
    a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height;

  function page(
    body: (d: FDocument) => FElement,
    rows: Record<string, R>,
    view: { w: number; h: number },
  ) {
    const doc = docWith(
      (d) => h(d, "html", {}, h(d, "head"), body(d)),
      "https://app.test/x",
      view.w,
      view.h,
    );
    const cys = Object.keys(rows);
    const by = (cy: string) =>
      find(doc, (e) => e.getAttribute("data-cy") === cy)!;
    for (const cy of cys) by(cy).rect = { ...rows[cy] };
    const frames: MirrorFrame[] = [];
    const rec = createRecorder(doc as unknown as Document, {
      emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
      Observer: FakeMutationObserver as unknown as typeof MutationObserver,
      manual: true,
    });
    const stage = new FDocument("about:srcdoc", view.w, view.h);
    stage.appendChild(h(stage, "html", {}, h(stage, "head"), h(stage, "body")));
    const boxes = () => {
      for (const cy of cys) {
        const s = find(stage, (e) => e.getAttribute("data-cy") === cy);
        if (s) s.rect = { ...rows[cy] };
      }
    };
    const rep = createReplayer(stage as unknown as Document, {
      schedule: (fn) => fn(),
      Resize: null,
    });
    rec.snapshot();
    expect(rep.apply(frames[0])).toBe(true);
    boxes();
    let at = 1;
    const drawn = (w: number) => {
      rec.flush();
      for (; at < frames.length; at++) {
        expect(rep.apply(frames[at])).toBe(true);
        boxes();
      }
      expect(rep.apply({ t: "ops", ops: [] } as unknown as MirrorFrame)).toBe(
        true,
      );
      const c = chip(stage)!;
      const left = Number(/left:(-?[\d.]+)px/.exec(c.style)![1]);
      const top = Number(/top:(-?[\d.]+)px/.exec(c.style)![1]);
      const text = c.text ?? "";
      const name = text.includes(" · ") ? text.split(" · ")[1] : "";
      return {
        left,
        top,
        width: w + (name ? name.length * 7.5 + 12 : 0),
        height: 26,
        text,
        style: c.style,
      };
    };
    return {
      stage,
      date: (cy: string) => {
        doc.fire("mousedown", by(cy));
        return drawn(DATE_W);
      },
      file: (btn: string, input: string) => {
        doc.fire("mousedown", by(btn));
        doc.fire("click", by(btn));
        doc.fire("click", by(input));
        return drawn(FILE_W);
      },
    };
  }

  test("m1: at 390 px with a logo uploaded (button, thumbnail, 'Logo cargado', a two-line hint, the next label right under) nothing by the button is clear — the chip takes the nearest clear band below, named, inside the frame, over nothing", () => {
    // /settings at 390×844 (es) as surveyed and as the five testers measured it
    const rows = {
      "overhead-input": { left: 43, top: 229, width: 304, height: 41 },
      "overhead-hint": { left: 43, top: 278, width: 304, height: 74 },
      "logo-row": { left: 43, top: 366, width: 304, height: 92 },
      "logo-btn": { left: 43, top: 366, width: 130, height: 43 },
      "logo-img": { left: 214, top: 373, width: 32, height: 32 },
      "logo-set": { left: 254, top: 381, width: 80, height: 15 },
      "logo-hint": { left: 43, top: 421, width: 304, height: 37 },
      "lang-label": { left: 43, top: 473, width: 116, height: 14 },
      "lang-select": { left: 43, top: 495, width: 304, height: 40 },
    };
    const c = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(d, "input", { type: "text", "data-cy": "overhead-input" }),
          h(
            d,
            "span",
            { "data-cy": "overhead-hint" },
            "$ = un monto en dólares por visita; % = un porcentaje del total",
          ),
          h(
            d,
            "div",
            { "data-cy": "logo-row" },
            h(d, "button", {
              type: "button",
              "data-cy": "logo-btn",
              "aria-label": "Reemplazar logo",
            }, "Reemplazar logo"),
            h(d, "input", {
              type: "file",
              "data-cy": "logo-file",
              style: "display:none",
            }),
            h(
              d,
              "span",
              {},
              h(d, "img", {
                "data-cy": "logo-img",
                src: "/api/files/x",
                alt: "Logo cargado",
              }),
              h(d, "span", { "data-cy": "logo-set" }, "Logo cargado"),
            ),
            h(
              d,
              "span",
              { "data-cy": "logo-hint" },
              "PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas",
            ),
          ),
          h(
            d,
            "label",
            {},
            h(d, "span", { "data-cy": "lang-label" }, "Idioma de la app"),
            h(d, "select", { "data-cy": "lang-select" }),
          ),
        ),
      rows,
      { w: 390, h: 844 },
    ).file("logo-btn", "logo-file");
    // REQ-862 AMENDMENT 6 (dm12, m2) — the nearest clear band here is the THIRD under the button
    // (148 px down, beside the field two rows away): past two bands the chip leaves the frame —
    // hidden here, its words (named) in the stage's chrome row (REQ-862 AMENDMENT 5)
    expect(c.style).toMatch(/display:none;/);
    expect(c.text).toBe("Customer is choosing a file… · Reemplazar logo");
  });

  test("m5: the invoice modal's 'Servicio hasta' date — the ledger's text behind the modal's backdrop does not push the chip; narrower than its field, the chip stays within the field's span (never over 'Servicio desde')", () => {
    const rows = {
      backdrop: { left: 0, top: 0, width: 1280, height: 800 },
      "behind-a": { left: 254, top: 378, width: 342, height: 16 },
      "behind-b": { left: 380, top: 425, width: 224, height: 16 },
      modal: { left: 320, top: 100, width: 640, height: 700 },
      "pair-row": { left: 346, top: 354, width: 588, height: 66 },
      "from-label": { left: 346, top: 356, width: 94, height: 16 },
      from: { left: 346, top: 380, width: 290, height: 41 },
      "to-label": { left: 644, top: 356, width: 91, height: 16 },
      to: { left: 644, top: 380, width: 290, height: 41 },
      concepts: { left: 346, top: 441, width: 80, height: 14 },
    };
    const p = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(
            d,
            "p",
            { "data-cy": "behind-a" },
            "No hay pagos reportados esperando tu confirmación",
          ),
          h(
            d,
            "p",
            { "data-cy": "behind-b" },
            "Nada en espera. Cuando envíes una factura",
          ),
          h(d, "div", { "data-cy": "backdrop" }),
          h(
            d,
            "div",
            { "data-cy": "modal", role: "dialog" },
            h(
              d,
              "div",
              { "data-cy": "pair-row" },
              h(
                d,
                "label",
                {},
                h(d, "span", { "data-cy": "from-label" }, "Servicio desde"),
                h(d, "input", { type: "date", "data-cy": "from" }),
              ),
              h(
                d,
                "label",
                {},
                h(d, "span", { "data-cy": "to-label" }, "Servicio hasta"),
                h(d, "input", { type: "date", "data-cy": "to" }),
              ),
            ),
            h(
              d,
              "div",
              {},
              h(d, "span", { "data-cy": "concepts" }, "Conceptos"),
            ),
          ),
        ),
      rows,
      { w: 1280, h: 800 },
    );
    const c = p.date("to");
    expect(hits(c, rows.to)).toBe(false);
    expect(hits(c, rows.from)).toBe(false);
    expect(hits(c, rows.concepts)).toBe(false);
    expect(c.left).toBeGreaterThanOrEqual(rows.to.left);
    expect(c.left + c.width).toBeLessThanOrEqual(rows.to.left + rows.to.width);
    // right under its own field: unnamed
    expect(Math.abs(c.top - (rows.to.top + rows.to.height)))
      .toBeLessThanOrEqual(5);
    expect(c.text).toBe("Choosing a date…");
  });
});

describe("REQ-862 AMENDMENT 4 / REQ-878 AMENDMENT 4 (demo-loop run 11, m1) — on a narrow frame the chip wraps to at most half the frame's width, so a dense 390 px form has room for it beside the thumbnail row (never the old 'under the button, on the thumbnail' fallback)", () => {
  const DATE_W = 156;
  const FILE_W = 249; // the Spanish "El cliente está eligiendo un archivo…"
  /** the chip's box as a browser would lay it out: one line at its natural width, or wrapped
   *  inside the `max-width` its style carries (13 px / 1.4 lines, 4 px padding top and bottom) */
  const sizeOf = (text: string, style: string) => {
    const base = text.startsWith("Choosing a date") ? DATE_W : FILE_W;
    const name = text.includes(" · ") ? text.split(" · ")[1] : "";
    const natural = base + (name ? name.length * 7.5 + 12 : 0);
    const m = /max-width:\s*([\d.]+)px/.exec(style);
    const max = m ? Number(m[1]) : Infinity;
    if (natural <= max) return { width: natural, height: 26 };
    const lines = Math.ceil((natural - 20) / (max - 20));
    return { width: max, height: 26 + 18.2 * (lines - 1) };
  };
  let spy: jest.SpyInstance;
  beforeEach(() => {
    const orig = FElement.prototype.getBoundingClientRect;
    spy = jest.spyOn(FElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: FElement) {
        if (this.hasAttribute("data-mirror-picker")) {
          const { width, height } = sizeOf(
            this.textContent ?? "",
            this.getAttribute("style") ?? "",
          );
          return {
            left: 0,
            top: 0,
            width,
            height,
            x: 0,
            y: 0,
            right: width,
            bottom: height,
          };
        }
        return orig.call(this);
      });
  });
  afterEach(() => spy.mockRestore());

  type R = { left: number; top: number; width: number; height: number };
  const hits = (a: R, b: R) =>
    a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height;

  function page(
    body: (d: FDocument) => FElement,
    rows: Record<string, R>,
    view: { w: number; h: number },
  ) {
    const doc = docWith(
      (d) => h(d, "html", {}, h(d, "head"), body(d)),
      "https://app.test/x",
      view.w,
      view.h,
    );
    const cys = Object.keys(rows);
    const by = (cy: string) =>
      find(doc, (e) => e.getAttribute("data-cy") === cy)!;
    for (const cy of cys) by(cy).rect = { ...rows[cy] };
    const frames: MirrorFrame[] = [];
    const rec = createRecorder(doc as unknown as Document, {
      emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
      Observer: FakeMutationObserver as unknown as typeof MutationObserver,
      manual: true,
    });
    const stage = new FDocument("about:srcdoc", view.w, view.h);
    stage.appendChild(h(stage, "html", {}, h(stage, "head"), h(stage, "body")));
    const boxes = () => {
      for (const cy of cys) {
        const s = find(stage, (e) => e.getAttribute("data-cy") === cy);
        if (s) s.rect = { ...rows[cy] };
      }
    };
    const rep = createReplayer(stage as unknown as Document, {
      schedule: (fn) => fn(),
      Resize: null,
    });
    rec.snapshot();
    expect(rep.apply(frames[0])).toBe(true);
    boxes();
    let at = 1;
    const drawn = () => {
      rec.flush();
      for (; at < frames.length; at++) {
        expect(rep.apply(frames[at])).toBe(true);
        boxes();
      }
      expect(rep.apply({ t: "ops", ops: [] } as unknown as MirrorFrame)).toBe(
        true,
      );
      const c = chip(stage)!;
      const left = Number(/left:(-?[\d.]+)px/.exec(c.style)![1]);
      const top = Number(/top:(-?[\d.]+)px/.exec(c.style)![1]);
      const text = c.text ?? "";
      const { width, height } = sizeOf(text, c.style);
      return { left, top, width, height, text, style: c.style };
    };
    return {
      file: (btn: string, input: string) => {
        doc.fire("mousedown", by(btn));
        doc.fire("click", by(btn));
        doc.fire("click", by(input));
        return drawn();
      },
    };
  }

  /** /settings at 390×844 (es) with a logo uploaded, as run 11's tester 3 measured it: the
   *  "Reemplazar logo" button is 159 px wide, so the thumbnail + "Logo cargado" wrap to their
   *  own line right under it; the two-line hint under that; the language field next; the
   *  overhead field's hint right above the button */
  const settings = () => {
    const rows = {
      // the fields above (a dense form: no band within 8 chip heights is clear)
      "head": { left: 0, top: 0, width: 390, height: 26 },
      "top-label": { left: 43, top: 30, width: 200, height: 12 },
      "top-input": { left: 43, top: 50, width: 304, height: 41 },
      "top-hint": { left: 43, top: 100, width: 304, height: 60 },
      "prev-label": { left: 43, top: 170, width: 200, height: 12 },
      "prev-input": { left: 43, top: 188, width: 304, height: 41 },
      "prev-hint": { left: 43, top: 233, width: 304, height: 14 },
      "overhead-input": { left: 43, top: 262, width: 304, height: 41 },
      "overhead-hint": { left: 43, top: 311, width: 304, height: 74 },
      "logo-row": { left: 43, top: 399, width: 304, height: 137 },
      "logo-btn": { left: 43, top: 399, width: 159, height: 43 },
      "logo-img": { left: 43, top: 455, width: 53, height: 32 },
      "logo-set": { left: 104, top: 463, width: 73, height: 14 },
      "logo-hint": { left: 43, top: 499, width: 304, height: 37 },
      "lang-label": { left: 43, top: 550, width: 116, height: 12 },
      "lang-select": { left: 43, top: 572, width: 304, height: 40 },
      // and the fields below, to the frame's foot
      "next-label": { left: 43, top: 628, width: 200, height: 12 },
      "next-input": { left: 43, top: 646, width: 304, height: 41 },
      "next-hint": { left: 43, top: 691, width: 304, height: 28 },
      "next2-label": { left: 43, top: 735, width: 200, height: 12 },
      "next2-input": { left: 43, top: 753, width: 304, height: 41 },
      "next2-hint": { left: 43, top: 798, width: 304, height: 46 },
    };
    const c = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(d, "header", { "data-cy": "head" }, "DocuMonster"),
          h(d, "span", { "data-cy": "top-label" }, "Tarifa por hora"),
          h(d, "input", { type: "text", "data-cy": "top-input" }),
          h(
            d,
            "span",
            { "data-cy": "top-hint" },
            "Lo que cobras por hora de trabajo; se usa en las cotizaciones.",
          ),
          h(d, "span", { "data-cy": "prev-label" }, "Margen"),
          h(d, "input", { type: "text", "data-cy": "prev-input" }),
          h(d, "span", { "data-cy": "prev-hint" }, "% sobre los materiales"),
          h(d, "input", { type: "text", "data-cy": "overhead-input" }),
          h(
            d,
            "span",
            { "data-cy": "overhead-hint" },
            "Un cargo fijo por visita que se suma a cada cotización. $ = una cantidad en dólares por visita. 0 = ninguno.",
          ),
          h(
            d,
            "div",
            { "data-cy": "logo-row" },
            h(d, "button", {
              type: "button",
              "data-cy": "logo-btn",
              "aria-label": "Reemplazar logo",
            }, "Reemplazar logo"),
            h(d, "input", {
              type: "file",
              "data-cy": "logo-file",
              style: "display:none",
            }),
            h(
              d,
              "span",
              {},
              h(d, "img", {
                "data-cy": "logo-img",
                src: "/api/files/x",
                alt: "Logo cargado",
              }),
              h(d, "span", { "data-cy": "logo-set" }, "Logo cargado"),
            ),
            h(
              d,
              "span",
              { "data-cy": "logo-hint" },
              "PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas",
            ),
          ),
          h(
            d,
            "label",
            {},
            h(d, "span", { "data-cy": "lang-label" }, "Idioma de la app"),
            h(d, "select", { "data-cy": "lang-select" }),
          ),
          h(d, "span", { "data-cy": "next-label" }, "Zona horaria"),
          h(d, "input", { type: "text", "data-cy": "next-input" }),
          h(
            d,
            "span",
            { "data-cy": "next-hint" },
            "Para las fechas de tus documentos",
          ),
          h(d, "span", { "data-cy": "next2-label" }, "Moneda"),
          h(d, "input", { type: "text", "data-cy": "next2-input" }),
          h(
            d,
            "span",
            { "data-cy": "next2-hint" },
            "Se muestra en cotizaciones y facturas. Cambiarla no convierte montos.",
          ),
        ),
      rows,
      { w: 390, h: 844 },
    ).file("logo-btn", "logo-file");
    return { c, rows };
  };

  test("m1: the 249 px chip wraps to ≤ 195 px (half of 390) and sits right of the thumbnail row, under the button's end — clear of the thumbnail, 'Logo cargado', the hint, the next label and the button; inside the frame", () => {
    const { c, rows } = settings();
    // clear of everything the customer reads (the row's box itself holds the chip's spot)
    for (const k of Object.keys(rows) as (keyof typeof rows)[]) {
      if (k === "logo-row") continue;
      expect([k, hits(c, rows[k]), c]).toEqual([k, false, c]);
    }
    expect(c.style).toMatch(/max-width:\s*195px/);
    expect(c.style).toMatch(/white-space:\s*normal/);
    expect(c.width).toBeLessThanOrEqual(195);
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.left + c.width).toBeLessThanOrEqual(390);
    expect(c.top + c.height).toBeLessThanOrEqual(844);
  });

  test("the chip on a 1280 px frame is one line as before: no max-width, no wrap", () => {
    const rows = {
      "logo-row": { left: 271, top: 408, width: 965, height: 43 },
      "logo-btn": { left: 271, top: 408, width: 123, height: 43 },
      "logo-hint": { left: 406, top: 422, width: 400, height: 14 },
    };
    const c = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(
            d,
            "div",
            { "data-cy": "logo-row" },
            h(
              d,
              "button",
              { type: "button", "data-cy": "logo-btn" },
              "Subir logo",
            ),
            h(d, "input", {
              type: "file",
              "data-cy": "logo-file",
              style: "display:none",
            }),
            h(
              d,
              "span",
              { "data-cy": "logo-hint" },
              "PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas",
            ),
          ),
        ),
      rows,
      { w: 1280, h: 800 },
    ).file("logo-btn", "logo-file");
    expect(c.style).not.toMatch(/max-width/);
    expect(c.height).toBe(26);
    expect(hits(c, rows["logo-hint"])).toBe(false);
    expect(hits(c, rows["logo-btn"])).toBe(false);
  });
});

import * as fs from "fs";
import * as path from "path";
const read = (rel: string) =>
  fs.readFileSync(path.join(path.resolve(__dirname, "../.."), rel), "utf8");

describe("REQ-862 AMENDMENT 5 / REQ-878 AMENDMENT 5 (demo-loop run 11, m1 — the dense page) — a chip with NO clear spot in the frame (even wrapped) is not drawn over the page: the replayer hides it and tells the stage (`onPicker`), which shows the chip's words in its chrome row above the frame", () => {
  const FILE_W = 249;
  const sizeOf = (text: string, style: string) => {
    const name = text.includes(" · ") ? text.split(" · ")[1] : "";
    const natural = FILE_W + (name ? name.length * 7.5 + 12 : 0);
    const m = /max-width:\s*([\d.]+)px/.exec(style);
    const max = m ? Number(m[1]) : Infinity;
    if (natural <= max) return { width: natural, height: 26 };
    const lines = Math.ceil((natural - 20) / (max - 20));
    return { width: max, height: 26 + 18.2 * (lines - 1) };
  };
  let spy: jest.SpyInstance;
  beforeEach(() => {
    const orig = FElement.prototype.getBoundingClientRect;
    spy = jest.spyOn(FElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: FElement) {
        if (this.hasAttribute("data-mirror-picker")) {
          const { width, height } = sizeOf(
            this.textContent ?? "",
            this.getAttribute("style") ?? "",
          );
          return {
            left: 0,
            top: 0,
            width,
            height,
            x: 0,
            y: 0,
            right: width,
            bottom: height,
          };
        }
        return orig.call(this);
      });
  });
  afterEach(() => spy.mockRestore());

  type R = { left: number; top: number; width: number; height: number };
  type Picker = { kind: string; text: string; inside: boolean } | null;

  function page(
    body: (d: FDocument) => FElement,
    rows: Record<string, R>,
    view: { w: number; h: number },
  ) {
    const doc = docWith(
      (d) => h(d, "html", {}, h(d, "head"), body(d)),
      "https://app.test/x",
      view.w,
      view.h,
    );
    const cys = Object.keys(rows);
    const by = (cy: string) =>
      find(doc, (e) => e.getAttribute("data-cy") === cy)!;
    for (const cy of cys) by(cy).rect = { ...rows[cy] };
    const frames: MirrorFrame[] = [];
    const rec = createRecorder(doc as unknown as Document, {
      emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
      Observer: FakeMutationObserver as unknown as typeof MutationObserver,
      manual: true,
    });
    const stage = new FDocument("about:srcdoc", view.w, view.h);
    stage.appendChild(h(stage, "html", {}, h(stage, "head"), h(stage, "body")));
    const boxes = () => {
      for (const cy of cys) {
        const s = find(stage, (e) => e.getAttribute("data-cy") === cy);
        if (s) s.rect = { ...rows[cy] };
      }
    };
    const told: Picker[] = [];
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: (fn) => fn(),
        Resize: null,
        onPicker: (p: Picker) => told.push(p),
      } as unknown as Parameters<typeof createReplayer>[1],
    );
    rec.snapshot();
    expect(rep.apply(frames[0])).toBe(true);
    boxes();
    let at = 1;
    const sync = () => {
      rec.flush();
      for (; at < frames.length; at++) {
        expect(rep.apply(frames[at])).toBe(true);
        boxes();
      }
      expect(rep.apply({ t: "ops", ops: [] } as unknown as MirrorFrame)).toBe(
        true,
      );
    };
    return {
      told,
      chip: () => chip(stage),
      open: (btn: string, input: string) => {
        doc.fire("mousedown", by(btn));
        doc.fire("click", by(btn));
        doc.fire("click", by(input));
        sync();
      },
      close: (input: string) => {
        doc.fire("change", by(input));
        sync();
      },
      dispose: () => rep.dispose(),
    };
  }

  /** the tester's /settings at 390×844 with a logo uploaded, and the caption as wide as the row
   *  (a longer business name beside the thumbnail): not even a wrapped chip has a spot */
  const dense = () => {
    const rows = {
      "head": { left: 0, top: 0, width: 390, height: 26 },
      "top-label": { left: 43, top: 30, width: 200, height: 12 },
      "top-input": { left: 43, top: 50, width: 304, height: 41 },
      "top-hint": { left: 43, top: 100, width: 304, height: 60 },
      "prev-label": { left: 43, top: 170, width: 200, height: 12 },
      "prev-input": { left: 43, top: 188, width: 304, height: 41 },
      "prev-hint": { left: 43, top: 233, width: 304, height: 14 },
      "overhead-input": { left: 43, top: 262, width: 304, height: 41 },
      "overhead-hint": { left: 43, top: 311, width: 304, height: 74 },
      "logo-row": { left: 43, top: 399, width: 304, height: 137 },
      "logo-btn": { left: 43, top: 399, width: 159, height: 43 },
      "logo-img": { left: 43, top: 455, width: 53, height: 32 },
      "logo-set": { left: 104, top: 463, width: 243, height: 14 },
      "logo-hint": { left: 43, top: 499, width: 304, height: 37 },
      "lang-label": { left: 43, top: 550, width: 116, height: 12 },
      "lang-select": { left: 43, top: 572, width: 304, height: 40 },
      "next-label": { left: 43, top: 628, width: 200, height: 12 },
      "next-input": { left: 43, top: 646, width: 304, height: 41 },
      "next-hint": { left: 43, top: 691, width: 304, height: 28 },
      "next2-label": { left: 43, top: 735, width: 200, height: 12 },
      "next2-input": { left: 43, top: 753, width: 304, height: 41 },
      "next2-hint": { left: 43, top: 798, width: 304, height: 46 },
    };
    return page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(d, "header", { "data-cy": "head" }, "DocuMonster"),
          h(d, "span", { "data-cy": "top-label" }, "Tarifa por hora"),
          h(d, "input", { type: "text", "data-cy": "top-input" }),
          h(
            d,
            "span",
            { "data-cy": "top-hint" },
            "Lo que cobras por hora de trabajo; se usa en las cotizaciones.",
          ),
          h(d, "span", { "data-cy": "prev-label" }, "Margen"),
          h(d, "input", { type: "text", "data-cy": "prev-input" }),
          h(d, "span", { "data-cy": "prev-hint" }, "% sobre los materiales"),
          h(d, "input", { type: "text", "data-cy": "overhead-input" }),
          h(
            d,
            "span",
            { "data-cy": "overhead-hint" },
            "Un cargo fijo por visita que se suma a cada cotización. $ = una cantidad en dólares por visita. 0 = ninguno.",
          ),
          h(
            d,
            "div",
            { "data-cy": "logo-row" },
            h(d, "button", {
              type: "button",
              "data-cy": "logo-btn",
              "aria-label": "Reemplazar logo",
            }, "Reemplazar logo"),
            h(d, "input", {
              type: "file",
              "data-cy": "logo-file",
              style: "display:none",
            }),
            h(
              d,
              "span",
              {},
              h(d, "img", {
                "data-cy": "logo-img",
                src: "/api/files/x",
                alt: "Logo cargado",
              }),
              h(
                d,
                "span",
                { "data-cy": "logo-set" },
                "Logo cargado · Ruiz Remodelación y Construcción",
              ),
            ),
            h(
              d,
              "span",
              { "data-cy": "logo-hint" },
              "PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas",
            ),
          ),
          h(
            d,
            "label",
            {},
            h(d, "span", { "data-cy": "lang-label" }, "Idioma de la app"),
            h(d, "select", { "data-cy": "lang-select" }),
          ),
          h(d, "span", { "data-cy": "next-label" }, "Zona horaria"),
          h(d, "input", { type: "text", "data-cy": "next-input" }),
          h(
            d,
            "span",
            { "data-cy": "next-hint" },
            "Para las fechas de tus documentos",
          ),
          h(d, "span", { "data-cy": "next2-label" }, "Moneda"),
          h(d, "input", { type: "text", "data-cy": "next2-input" }),
          h(
            d,
            "span",
            { "data-cy": "next2-hint" },
            "Se muestra en cotizaciones y facturas. Cambiarla no convierte montos.",
          ),
        ),
      rows,
      { w: 390, h: 844 },
    );
  };

  test("the dense page: the in-frame chip is hidden (display:none), and the stage is told the chip's words, named, with inside:false; the chooser closing tells it null", () => {
    const pg = dense();
    pg.open("logo-btn", "logo-file");
    const c = pg.chip()!;
    expect(c.style).toMatch(/display:none/);
    expect(pg.told).toEqual([
      {
        kind: "file",
        text: "Customer is choosing a file… · Reemplazar logo",
        inside: false,
      },
    ]);
    pg.close("logo-file");
    expect(pg.told[pg.told.length - 1]).toBeNull();
  });

  test("a page with room (1280 px): the chip is drawn in the frame as before and the stage is told inside:true", () => {
    const rows = {
      "logo-row": { left: 271, top: 408, width: 965, height: 43 },
      "logo-btn": { left: 271, top: 408, width: 123, height: 43 },
      "logo-hint": { left: 406, top: 422, width: 400, height: 14 },
    };
    const pg = page(
      (d) =>
        h(
          d,
          "body",
          {},
          h(
            d,
            "div",
            { "data-cy": "logo-row" },
            h(
              d,
              "button",
              { type: "button", "data-cy": "logo-btn" },
              "Subir logo",
            ),
            h(d, "input", {
              type: "file",
              "data-cy": "logo-file",
              style: "display:none",
            }),
            h(
              d,
              "span",
              { "data-cy": "logo-hint" },
              "PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas",
            ),
          ),
        ),
      rows,
      { w: 1280, h: 800 },
    );
    pg.open("logo-btn", "logo-file");
    expect(pg.chip()!.style).not.toMatch(/display:none/);
    // past the row's hint (REQ-878 AMENDMENT: named), inside the frame
    expect(pg.told.length).toBe(1);
    expect(pg.told[0]).toMatchObject({ kind: "file", inside: true });
    expect(pg.told[0]!.text.startsWith("Customer is choosing a file…")).toBe(
      true,
    );
    pg.dispose();
    expect(pg.told[pg.told.length - 1]).toBeNull();
  });

  test("wiring: DemoStage passes onPicker to its replayer, keeps the words of a chip that is outside, and draws them in the chrome row (data-cy demo-picker-outside) when no tab notice is up", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(
      /const \[pickerOut, setPickerOut\] = useState<string \| null>\(null\)/,
    );
    expect(stage).toMatch(
      /onPicker:\s*\(p\) =>\s*setPickerOut\(p && !p\.inside \? p\.text : null\)/,
    );
    expect(stage).toMatch(
      /pickerOut !== null && tabNote === null && \(\s*<div\s+data-cy="demo-picker-outside"/,
    );
  });
});

describe("REQ-862 AMENDMENT 6 / REQ-878 AMENDMENT 6 (demo-loop run 12, m2 + m3) — a chip goes at most two bands from its control (further, the chrome row); the chrome row's picker words come before the pointer-off hint", () => {
  test("m2: CHIP_BANDS is 2 — the bands tier stops two steps each way, so a chip never sits 150–197 px under its button beside another field", () => {
    const src = read("front-end/lib/demo-mode/mirror-replay.ts");
    expect(src).toMatch(/const CHIP_BANDS = 2;/);
    expect(src).toMatch(/for \(let k = 1; k <= CHIP_BANDS; k\+\+\)/);
    expect(src).not.toMatch(/k <= 8/);
  });
  test("m3: the stage draws the picker's words in the chrome row whether or not his mouse is outside the frame, and the pointer-off hint yields to them", () => {
    const src = read("front-end/islands/DemoStage.tsx");
    expect(src).toMatch(
      /pickerOut !== null && tabNote === null && \(\s*<div\s+data-cy="demo-picker-outside"/,
    );
    expect(src).not.toMatch(/pickerOut !== null && tabNote === null && !off/);
    expect(src).toMatch(
      /badges && off && pickerOut === null && \(\s*<div\s+data-cy="demo-pointer-off"/,
    );
  });
});
