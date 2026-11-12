/**
 * REQ-335 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issue M31: "Job description from the wrong card
 * used (clicking a bullet line may not select the card)".
 *
 * Cause (RCA at 4da03589, analyst + skeptic CONFIRMED): in the Job Details
 * picker each bullet's text was a button whose onClick did
 * `e.stopPropagation(); startBulletEdit(...)` — it opened inline editing and
 * stopped the click reaching the card's `onClick={() => setSelectedOptionId}`.
 * The title pencil and the delete × stopped propagation the same way. So a
 * tap on card 3's line never selected card 3; the selection stayed on the
 * default (drafts[0]) and Continue applied card 1.
 *
 * Rule now (shared/quote-flow/option-tap.ts, `optionTap`): a tap ANYWHERE in
 * a card chooses that card — bullet text, bullet pencil, delete/restore,
 * title, title pencil. Only the pencils open inline editing; a bullet tap
 * just selects. The island routes every one of those handlers through it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { optionTap } from "../../shared/quote-flow/option-tap";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("REQ-335 M31: a tap inside a job-option card selects that card", () => {
  it("REQ-335 a bullet text tap selects the card and opens no editor", () => {
    expect(
      optionTap({ kind: "bullet", optionId: "opt3", bulletId: "b2" }),
    ).toEqual({
      selectedOptionId: "opt3",
      editBullet: null,
      editTitle: false,
      toggleDeleted: null,
    });
  });

  it("REQ-335 the bullet pencil selects the card AND edits that bullet (not a deleted one)", () => {
    expect(
      optionTap({ kind: "bulletPencil", optionId: "opt3", bulletId: "b2" }),
    ).toEqual({
      selectedOptionId: "opt3",
      editBullet: "b2",
      editTitle: false,
      toggleDeleted: null,
    });
    expect(
      optionTap({
        kind: "bulletPencil",
        optionId: "opt3",
        bulletId: "b2",
        deleted: true,
      }).editBullet,
    ).toBeNull();
  });

  it("REQ-335 delete/restore and the title pencil select the card too", () => {
    expect(optionTap({ kind: "delete", optionId: "opt2", bulletId: "b1" }))
      .toEqual({
        selectedOptionId: "opt2",
        editBullet: null,
        editTitle: false,
        toggleDeleted: "b1",
      });
    expect(optionTap({ kind: "titlePencil", optionId: "opt2" })).toEqual({
      selectedOptionId: "opt2",
      editBullet: null,
      editTitle: true,
      toggleDeleted: null,
    });
    expect(optionTap({ kind: "title", optionId: "opt2" }).selectedOptionId)
      .toBe("opt2");
  });

  it("REQ-335 the island routes bullet text, bullet pencil, delete and title pencil through optionTap", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /from "\.\.\/\.\.\/shared\/quote-flow\/option-tap\.ts"/,
    );
    // every handler kind the picker renders goes through the one rule
    for (const kind of ["bullet", "bulletPencil", "delete", "titlePencil"]) {
      expect(src).toMatch(new RegExp(`kind:\\s*"${kind}"`));
    }
    // the bullet TEXT button no longer opens inline editing itself
    const textBtn = src.slice(
      src.indexOf('class="chat__jobopt-text"'),
      src.indexOf('class="chat__jobopt-pencil"'),
    );
    expect(textBtn.length).toBeGreaterThan(0);
    expect(textBtn).not.toMatch(/startBulletEdit\(/);
    expect(textBtn).toMatch(/kind:\s*"bullet"/);
    // and a per-bullet pencil exists, labelled in the dictionary
    expect(src).toMatch(/asstChat\.jobOpts\.editBullet/);
  });

  it("REQ-335 the bullet pencil label exists in en and es", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["asstChat.jobOpts.editBullet"]).toBe("Edit bullet");
    expect(es["asstChat.jobOpts.editBullet"]).toBe("Editar punto");
  });
});
