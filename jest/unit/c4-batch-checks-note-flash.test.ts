/**
 * REQ-608 — demo-loop cycle 4, demo issue m47: "Worker note saves with no 'Saved'; batch unticked
 * after reload".
 *
 *  (a) /field/batches: only pull() pre-ticked a batch's draft invoices; after F5 the mount load()
 *      showed the same drafts unticked and "Send selected" disabled. Now the page opens (or a
 *      batch is opened from the list) with its drafts ticked — the same rule pull() uses
 *      (`defaultBatchChecks` in front-end/lib/field-batches.ts).
 *  (b) /worker: saveNote's "Note saved" line lived 1500 ms and its timer started BEFORE act()'s
 *      follow-up reload, so it was gone by the time anyone looked. Now it is shown after the
 *      reload and stays until the note is edited again or NOTE_SAVED_MS (>= 4 s) passes.
 */
import * as fs from "fs";
import * as path from "path";
import {
  defaultBatchChecks,
  NOTE_SAVED_MS,
} from "../../front-end/lib/field-batches";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const batch = {
  invoices: [
    { id: "d1", status: "draft" },
    { id: "s1", status: "sent" },
    { id: "d2", status: "draft" },
    { id: "p1", status: "paid" },
  ],
};

describe("REQ-608 (demo m47, cycle 4) a loaded batch ticks its drafts", () => {
  test("nothing ticked yet → the batch's draft invoices, as after a pull", () => {
    expect([...defaultBatchChecks(batch, new Set())].sort()).toEqual([
      "d1",
      "d2",
    ]);
  });

  test("ticks the office already made are kept", () => {
    const mine = new Set(["d2"]);
    expect(defaultBatchChecks(batch, mine)).toBe(mine);
  });

  test("no batch, or a batch with no drafts → nothing ticked", () => {
    expect(defaultBatchChecks(null, new Set()).size).toBe(0);
    expect(
      defaultBatchChecks({ invoices: [{ id: "s", status: "sent" }] }, new Set())
        .size,
    ).toBe(0);
  });

  test("FieldBatchesPage's mount load and openBatch use the rule, not an empty set", () => {
    const src = read("front-end/islands/FieldBatchesPage.tsx");
    const mount = src.slice(
      src.indexOf("useEffect(() => {\n    load()"),
      src.indexOf("async function pull()"),
    );
    expect(mount).toMatch(/defaultBatchChecks\(/);
    const open = src.slice(src.indexOf("function openBatch("));
    expect(open.slice(0, open.indexOf("\n  }\n"))).toMatch(
      /defaultBatchChecks\(/,
    );
  });
});

describe("REQ-608 (demo m47, cycle 4) the worker's 'Note saved' is there to be seen", () => {
  test("it is held for at least 4 s", () => {
    expect(NOTE_SAVED_MS).toBeGreaterThanOrEqual(4000);
  });

  test("saveNote shows it AFTER act()'s reload, held for NOTE_SAVED_MS, and an edit clears it", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    const save = src.slice(
      src.indexOf("function saveNote("),
      src.indexOf("function deferGo("),
    );
    expect(save).not.toMatch(/\b1500\b/);
    expect(save).toMatch(/NOTE_SAVED_MS/);
    // the flash is set once act() resolved — i.e. after its load() — not inside fn
    const actCall = save.search(/await act\(`note:/);
    const flashSet = save.indexOf('t("worker.saved")');
    expect(actCall).toBeGreaterThan(-1);
    expect(flashSet).toBeGreaterThan(actCall);
    // ...and outside the action fn (whose body ends before the flash is set)
    expect(save.slice(actCall, flashSet)).toMatch(/\n {4}\}\);\n/);
    // act() reports whether it worked, so a failed save never says "saved"
    expect(src).toMatch(/async function act\([^)]*\)[^{]*Promise<boolean>/);
    // typing in the note again clears the line
    const ta = src.slice(src.indexOf('data-cy="w-note"'));
    expect(ta.slice(0, ta.indexOf("/>"))).toMatch(/clearFlash\(v\.id\)/);
  });
});
