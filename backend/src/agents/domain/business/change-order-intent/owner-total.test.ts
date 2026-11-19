/**
 * REQ-1095 (LOOP-007 cycle 3, q3-19) — a revision's new total is one the
 * owner's words carry. "add hallway painting $450 to Q-002" holds none, yet
 * the model sent newTotalDollars 2680 (Q-002's CURRENT total) and settling to
 * it folded the removed drywall's $380 into the painting line.
 */
import { assertEquals } from "#std/assert";
import { ownerStatedTotalCents } from "./mod.ts";

Deno.test("REQ-1095 q3-19: the model echoing the current total, with no total in the words, is ignored", () => {
  assertEquals(
    ownerStatedTotalCents({
      userText: "add hallway painting $450 to Q-002",
      modelTotalCents: 268_000,
      currentTotalCents: 268_000,
    }),
    undefined,
  );
});

Deno.test("REQ-1095 q3-19: a model total the words never carry is ignored", () => {
  assertEquals(
    ownerStatedTotalCents({
      userText: "remove the drywall from Q-002",
      modelTotalCents: 250_000,
      currentTotalCents: 268_000,
    }),
    undefined,
  );
});

Deno.test("REQ-1095 q3-19: a total he stated is kept — with or without a model total (REQ-1027)", () => {
  const text =
    "jorge dijo que es mucho. haz una version 2 de Q-002 sin la cerca, solo la pintura, total 5,550";
  assertEquals(
    ownerStatedTotalCents({
      userText: text,
      modelTotalCents: 555_000,
      currentTotalCents: 645_000,
    }),
    555_000,
  );
  assertEquals(
    ownerStatedTotalCents({ userText: text, currentTotalCents: 645_000 }),
    555_000,
  );
  assertEquals(
    ownerStatedTotalCents({
      userText: "make Q-002 $2,680 without the drywall",
      modelTotalCents: 268_000,
      currentTotalCents: 268_000,
    }),
    268_000,
  );
});

Deno.test("REQ-1095 q3-19: the current total moved by an amount he typed is his total", () => {
  assertEquals(
    ownerStatedTotalCents({
      userText: "take $500 off Q-002",
      modelTotalCents: 218_000,
      currentTotalCents: 268_000,
    }),
    218_000,
  );
});
