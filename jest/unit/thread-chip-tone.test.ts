/**
 * REQ-453 (demo-loop cycle 3, demo issues p8-pair5-d and p8-pair2-b) —
 * "Red 'Gathering a little more info' chip" / "Red chips for positive
 * states (e.g. 'Lista para enviar')". Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * Root cause (RCA, CONFIRMED, skeptic UPHELD at cc5d4b0e): `threadChip`
 * (shared/quote-flow/chat-header.ts) mapped every status but accepted / sent
 * / drafted to the kind "needs", which assistant-page.css paints pink — the
 * alert colour — so normal in-progress steps (locked, gathering,
 * pickingDetails, readyToSend) looked like problems.
 *
 * Target: a neutral "progress" kind for the in-progress steps; "needs"
 * (pink) only for undelivered and declined.
 */
import * as fs from "fs";
import * as path from "path";
import {
  THREAD_STATUSES,
  threadChip,
  type ThreadChipKind,
  type ThreadStatus,
} from "../../shared/quote-flow/chat-header";

const EXPECTED: Record<ThreadStatus, ThreadChipKind | null> = {
  none: null,
  drafted: "draft",
  locked: "progress",
  gathering: "progress",
  // REQ-454 (merged on demo-fixes): locked + in the terms wizard — progress
  addingTerms: "progress",
  pickingDetails: "progress",
  readyToSend: "progress",
  undelivered: "needs",
  // REQ-572 (cycle 4, p4-p7c): the owner shared the link — it went out
  sharedByLink: "sent",
  sent: "sent",
  declined: "needs",
  accepted: "paid",
};

/** The declarations of one CSS rule `selector { … }`. */
function rule(css: string, selector: string): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
}

describe("REQ-453 the conversation list's chip tone fits the status", () => {
  it("every ThreadStatus maps to its tone", () => {
    for (const s of THREAD_STATUSES) {
      expect([s, threadChip(s)?.kind ?? null]).toEqual([s, EXPECTED[s]]);
    }
  });

  it("in-progress steps (locked, gathering, picking details, ready to send) are never the alert tone", () => {
    for (
      const s of [
        "locked",
        "gathering",
        "pickingDetails",
        "readyToSend",
      ] as ThreadStatus[]
    ) {
      expect([s, threadChip(s)?.kind]).toEqual([s, "progress"]);
    }
  });

  it("only a failed send or a declined quote asks for attention", () => {
    const needs = THREAD_STATUSES.filter((s) =>
      threadChip(s)?.kind === "needs"
    );
    expect(needs.sort()).toEqual(["declined", "undelivered"]);
  });

  it("assistant-page.css paints progress in a neutral teal/coffee, needs stays pink", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../front-end/static/assistant-page.css"),
      "utf8",
    );
    const progress = rule(css, ".thread__chip--progress");
    expect(progress).toBeDefined();
    expect(progress).toMatch(/var\(--(teal|coffee)-\d+\)/);
    expect(progress).not.toMatch(/pink|red/);
    expect(rule(css, ".thread__chip--needs")).toMatch(/pink/);
  });
});
