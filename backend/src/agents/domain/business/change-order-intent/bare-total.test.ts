/**
 * REQ-1027 (LOOP-007 cycle 2, q2-4) — "haz una version 2 de Q-002 sin la
 * cerca, solo la pintura, total 5,550": the owner typed the job's new total
 * with no "$". parseTargetTotalChange (REQ-377) needed exactly one "$"
 * amount, so it read nothing, and the model put $5,550 on the painting line
 * instead (v2 $6,900 — $450 MORE than the v1 he called too much). A total
 * word next to a bare number is the job's new total.
 */
import { assertEquals } from "#std/assert";
import { parseTargetTotalChange } from "./mod.ts";

const Q24 =
  "jorge dijo que es mucho. haz una version 2 de Q-002 sin la cerca, solo la pintura, total 5,550";

Deno.test("REQ-1027 q2-4 parseTargetTotalChange: the tester's exact sentence is a new total of $5,550 for Q-002", () => {
  const got = parseTargetTotalChange(Q24);
  assertEquals(got?.targetTotalCents, 555_000, JSON.stringify(got));
  assertEquals(got?.quoteNumber, "Q-002", JSON.stringify(got));
});

Deno.test("REQ-1027 q2-4 parseTargetTotalChange: a total word with a bare number, with or without '$' (ES + EN)", () => {
  for (
    const s of [
      "haz una version 2 de Q-002 sin la cerca, total 5,550",
      "quita la cerca, total de 5550",
      "sin la cerca, en total 5,550",
      "sin la cerca, 5,550 total",
      "drop the fence, total 5,550",
      "drop the fence, new total 5550",
    ]
  ) {
    assertEquals(parseTargetTotalChange(s)?.targetTotalCents, 555_000, s);
  }
});
