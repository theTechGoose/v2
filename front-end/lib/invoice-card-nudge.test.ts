/**
 * REQ-477 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issue M31, RCA FEATURE_GAP /
 * skeptic UPHELD at cc5d4b0e: an ordinary unpaid (sent, not yet overdue)
 * invoice card had no manual reminder — "Send a nudge" rendered only on a
 * claimed card (and as an overdue card's stage CTA).
 */
import { assertEquals } from "@std/assert";
import { hasNudgeButton } from "./invoice-card.ts";
import { tFor } from "./i18n.ts";

Deno.test("REQ-477 M31: an out (sent, not yet overdue) card carries a 'Send a nudge' button", () => {
  assertEquals(hasNudgeButton("out"), true);
  assertEquals(tFor("en", "invoicesPage.back.nudge"), "Send a nudge");
});

Deno.test("REQ-477 M31: claimed keeps its nudge; overdue's CTA already is one; nothing else gets it", () => {
  assertEquals(hasNudgeButton("claimed"), true);
  assertEquals(hasNudgeButton("overdue"), false);
  for (const s of ["scheduled", "drafting", "paid"] as const) {
    assertEquals(hasNudgeButton(s), false, s);
  }
});
