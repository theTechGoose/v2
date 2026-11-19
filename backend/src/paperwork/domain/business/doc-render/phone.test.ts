/**
 * REQ-965 — LOOP-007 cycle 1, issues q1-42 + q1-43: every phone a document
 * prints reads "(843) 555-0277", the one display the web pages use (shared
 * fmtPhone), never the stored string ("8435550277", "843-555-0142",
 * "+15125550702") and never a second format ("+1 (512) 555-0702").
 */
import { assert, assertEquals } from "#std/assert";
import { fmtPhone } from "#identity/phone.ts";
import { formatPhoneDisplay } from "#quote-flow/format-helpers.ts";
import { customerLines } from "./mod.ts";

Deno.test("REQ-965 (q1-42) customerLines: a customer typed as '8435550277' is drawn '(843) 555-0277', not the raw digits", () => {
  const lines = customerLines({
    name: "Dana Pruitt",
    phoneNumber: "8435550277",
    email: "dana@example.com",
  });
  assert(
    lines.includes("(843) 555-0277"),
    `the formatted phone line: ${JSON.stringify(lines)}`,
  );
  assert(!lines.includes("8435550277"), `no raw phone: ${JSON.stringify(lines)}`);
});

Deno.test("REQ-965 (q1-42) customerLines: '843-555-0142' and '+18435550142' are drawn '(843) 555-0142'", () => {
  for (const phoneNumber of ["843-555-0142", "+18435550142"]) {
    const lines = customerLines({ name: "Dana Pruitt", phoneNumber });
    assertEquals(lines, ["Dana Pruitt", "(843) 555-0142"], phoneNumber);
  }
});

Deno.test("REQ-965 (q1-42) customerLines: a non-US number is left as typed", () => {
  const lines = customerLines({ name: "Ana", phoneNumber: "+44 20 7946 0958" });
  assertEquals(lines, ["Ana", "+44 20 7946 0958"]);
});

Deno.test("REQ-965 (q1-43) formatPhoneDisplay agrees with fmtPhone for E.164, 10-digit and masked US numbers", () => {
  for (const raw of ["+15125550701", "5125550701", "(512) 555-0701", "512-555-0701"]) {
    assertEquals(formatPhoneDisplay(raw), fmtPhone(raw), raw);
  }
  assertEquals(formatPhoneDisplay("+15125550701"), "(512) 555-0701");
});
