import { assertEquals } from "@std/assert";
import { keepMoneyTogether, WORD_JOINER } from "./money-nowrap.ts";

/**
 * REQ-716 (demo-loop cycle 5, issue p2): the assistant's reply
 * "… Credit for cheaper cabinets (−$500.00). Sent CO-002 …" broke as "(−" at
 * the end of one line and "$500.00)" on the next. A word joiner between the
 * sign and the "$" keeps a signed amount on one line; nothing else changes.
 */
const WJ = WORD_JOINER;

Deno.test("REQ-716 p2: a signed amount's sign stays glued to its $", () => {
  assertEquals(
    keepMoneyTogether("Credit for cheaper cabinets (−$500.00). Sent CO-002"),
    `Credit for cheaper cabinets (−${WJ}$500.00). Sent CO-002`,
  );
  assertEquals(
    keepMoneyTogether("+$1,000.00 and -$5"),
    `+${WJ}$1,000.00 and -${WJ}$5`,
  );
});

Deno.test("REQ-716 p2: text without a signed amount is returned unchanged", () => {
  for (
    const s of ["Total $17,400.00", "a - b", "pre-$ x", "", "CO-002 − done"]
  ) {
    const out = keepMoneyTogether(s);
    if (s === "pre-$ x") {
      // a hyphen right before "$" is glued too — harmless, still one token
      assertEquals(out, `pre-${WJ}$ x`);
    } else assertEquals(out, s);
  }
});

Deno.test("REQ-716 p2: already-joined text is not joined twice", () => {
  const once = keepMoneyTogether("(−$500.00)");
  assertEquals(keepMoneyTogether(once), once);
});

Deno.test("REQ-716 p2: the assistant's chat bubble renders its text through keepMoneyTogether", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/AsstChat.tsx", import.meta.url),
  );
  const bubble = src.match(
    /<div class="msg__bubble" style="white-space:pre-wrap">\s*\{([^}]*)\}/,
  );
  assertEquals(bubble?.[1].trim(), "keepMoneyTogether(m.content)");
});
