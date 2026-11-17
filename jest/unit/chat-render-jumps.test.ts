/**
 * REQ-662 (demo-loop cycle 5, m19) — "The assistant chat jumps, hides
 * messages or leaves big blank areas".
 *
 *  (c) pair 5 (fleet-4 stdout:141): her "Change the quote…" messages and the
 *      replies vanished during the Lock-it-in steps and came back on reload —
 *      lockActionCard kept only the thread BEFORE the clicked card
 *      (`m.slice(0, idx)`), dropping everything after it. The server keeps
 *      them; the live view now drops the clicked card only (REQ-318 hides it
 *      on reload too) and appends the locked card + CTA.
 *  (b) pair 7 (fleet-6 stdout:185-186): a turn's messages are appended in
 *      createdAt order, the order a reload shows.
 *  (a) pair 10 (fleet-9 stdout:27): a reopened picker with no options
 *      showed "Writing up your options…" with nothing in flight
 *      (`optionsLoading || !jobOptions`). The loader shows only while a
 *      request runs; a restored picker without options refetches them, or
 *      closes when there is nothing to write them from.
 */
import * as fs from "fs";
import * as path from "path";
import {
  mergeLockedCard,
  mergeTurnMessages,
} from "../../front-end/lib/turn-messages";
import { restoredPickerAction } from "../../front-end/lib/picker-restore";

const ROOT = path.resolve(__dirname, "../..");
const island = fs.readFileSync(
  path.join(ROOT, "front-end/islands/AsstChat.tsx"),
  "utf8",
);
const fnBody = (start: string, end: string) => {
  const from = island.slice(island.indexOf(start));
  return from.slice(0, from.indexOf(end));
};

type M = { id: string; createdAt?: string };

describe("REQ-662 m19 (c) pair 5: Lock it in keeps the thread after the card", () => {
  const thread: M[] = [
    { id: "u1" },
    { id: "card" }, // the draft card she then edited by chat
    { id: "u2" }, // "Change the quote: …"
    { id: "a2" }, // "Updated the quote."
    { id: "u3" },
    { id: "a3" },
  ];

  test("only the clicked draft card leaves; her edits and the replies stay, the locked card + CTA append", () => {
    const merged = mergeLockedCard(thread, "card", [
      { id: "locked" },
      { id: "cta" },
    ]);
    expect(merged.map((m) => m.id)).toEqual([
      "u1",
      "u2",
      "a2",
      "u3",
      "a3",
      "locked",
      "cta",
    ]);
  });

  test("a card no longer in the thread drops nothing", () => {
    expect(
      mergeLockedCard(thread, "gone", [{ id: "locked" }]).map((m) => m.id),
    ).toEqual(["u1", "card", "u2", "a2", "u3", "a3", "locked"]);
  });

  test("a re-lock that returns a message already shown never doubles it", () => {
    expect(
      mergeLockedCard([...thread, { id: "locked" }], "card", [{ id: "locked" }])
        .map((m) => m.id),
    ).toEqual(["u1", "u2", "a2", "u3", "a3", "locked"]);
  });

  test("the island's lockActionCard uses it — never slices the thread at the card", () => {
    const body = fnBody(
      "async function lockActionCard(",
      "async function reopenActionCard(",
    );
    expect(body).toMatch(/mergeLockedCard\(/);
    expect(body).not.toMatch(/\.slice\(0, idx\)/);
  });
});

describe("REQ-662 m19 (b) pair 7: a turn's new messages land in createdAt order", () => {
  test("appended messages are sorted by createdAt, as a reload shows them", () => {
    const merged = mergeTurnMessages(
      [{ id: "old", createdAt: "2026-11-12T10:00:00.000Z" }],
      [
        { id: "u", createdAt: "2026-11-12T10:01:00.000Z" },
        { id: "q", createdAt: "2026-11-12T10:01:00.003Z" },
        { id: "r", createdAt: "2026-11-12T10:01:00.002Z" },
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(["old", "u", "r", "q"]);
  });

  test("messages without createdAt keep the order they came in", () => {
    expect(
      mergeTurnMessages([], [{ id: "a" }, { id: "b" }, { id: "c" }]).map((m) =>
        m.id
      ),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("REQ-662 m19 (a) pair 10: no 'Writing up your options…' with nothing in flight", () => {
  const base = {
    jobOptionsOpen: true,
    pickerMode: "polish" as const,
    jobOptions: null,
    jobDetailsRaw: null,
    submittedJobDetails: null,
  };

  test("a restored polish picker without options refetches them", () => {
    expect(restoredPickerAction(base)).toBe("refetch_polish");
  });

  test("a restored confirm picker without options refetches from the typed details", () => {
    expect(
      restoredPickerAction({
        ...base,
        pickerMode: "confirm",
        submittedJobDetails: "kitchen remodel",
      }),
    ).toBe("refetch_confirm");
  });

  test("a confirm picker with nothing to write options from closes", () => {
    expect(
      restoredPickerAction({
        ...base,
        pickerMode: "confirm",
        jobDetailsRaw: "   ",
      }),
    ).toBe("close");
  });

  test("a picker restored WITH its options, or no picker, does nothing", () => {
    expect(restoredPickerAction({ ...base, jobOptions: [{}] })).toBe("none");
    expect(restoredPickerAction({ ...base, jobOptionsOpen: false })).toBe(
      "none",
    );
  });

  test("the island shows the loader only while a request runs and acts on the restore", () => {
    expect(island).not.toMatch(/optionsLoading \|\| !jobOptions/);
    expect(island).toMatch(/restoredPickerAction\(/);
  });
});
