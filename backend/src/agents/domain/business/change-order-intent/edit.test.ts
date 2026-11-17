/**
 * REQ-462 (demo-loop cycle 3, M26) — "Change of plan on CO-001: make it
 * $1,000 and the description should just say "Upgrade to frameless glass
 * shower door"." is an edit of THAT change order. Nothing read "CO-001": the
 * model got the sentence, had no tool for it, called revise_quote on the
 * signed Q-001 and the reply was "…signed, so its lines can't change".
 */
import { assertEquals } from "#std/assert";
import {
  changeOrderNumbersIn,
  editedChangeOrderDelta,
  parseChangeOrderEdit,
  reconcileChangeOrderAmount,
} from "./mod.ts";

const DEMO =
  'Change of plan on CO-001: make it $1,000 and the description should just say "Upgrade to frameless glass shower door".';

Deno.test("REQ-462 M26 parseChangeOrderEdit: the demo's exact sentence is CO-001 at $1,000 with the quoted wording", () => {
  assertEquals(parseChangeOrderEdit(DEMO), {
    changeOrderNumber: "CO-001",
    amountCents: 100_000,
    description: "Upgrade to frameless glass shower door",
  });
});

Deno.test("REQ-462 M26 parseChangeOrderEdit: a new amount, however it is said", () => {
  const cases: [string, number][] = [
    ["Lower CO-001 to $1,000", 100_000],
    ["make co-2 $450.50", 45_050],
    ["CO-001 should be $1,000 instead of $1,200", 100_000],
    ["Change CO-003 from $1,200 to $950", 95_000],
    ["Can you bump CO-004 up to $2,000?", 200_000],
    ["CO-001: $1,000 not $1,200", 100_000],
    ["Cambia CO-001 a $1,000", 100_000],
    ["Baja la CO-001 de $1,200 a $900", 90_000],
  ];
  for (const [text, cents] of cases) {
    const got = parseChangeOrderEdit(text);
    assertEquals(got?.amountCents, cents, text);
    assertEquals(got?.withdraw, undefined, text);
  }
  assertEquals(
    parseChangeOrderEdit("make co-2 $450.50")?.changeOrderNumber,
    "CO-2",
  );
});

Deno.test("REQ-462 M26 parseChangeOrderEdit: 'credit' makes the new amount a credit", () => {
  assertEquals(parseChangeOrderEdit("Make CO-002 a $50 credit"), {
    changeOrderNumber: "CO-002",
    amountCents: -5_000,
  });
  assertEquals(
    parseChangeOrderEdit("change CO-002 to a credit of $75")?.amountCents,
    -7_500,
  );
});

Deno.test("REQ-462 M26 parseChangeOrderEdit: a new wording — quoted, or after 'should say' / 'call it' / 'rename'", () => {
  const cases: [string, string][] = [
    [
      "Rename CO-001 to “Frameless glass shower door”",
      "Frameless glass shower door",
    ],
    [
      "CO-001: the description should say frameless glass shower door, and make it $1,000",
      "Frameless glass shower door",
    ],
    ["call CO-005 'Brushed nickel fixtures'", "Brushed nickel fixtures"],
    ["CO-001 should read Frameless glass door.", "Frameless glass door"],
    [
      'CO-001: que diga "Puerta de vidrio sin marco"',
      "Puerta de vidrio sin marco",
    ],
  ];
  for (const [text, description] of cases) {
    assertEquals(parseChangeOrderEdit(text)?.description, description, text);
  }
  assertEquals(
    parseChangeOrderEdit(
      "CO-001: the description should say frameless glass shower door, and make it $1,000",
    )?.amountCents,
    100_000,
  );
});

Deno.test("REQ-462 M26 parseChangeOrderEdit: withdraw / cancel / delete — said as an instruction", () => {
  for (
    const text of [
      "Withdraw CO-001",
      "Please cancel change order CO-001",
      "Karen said no, so delete CO-001.",
      "CO-001 — scrap it",
      "Can you withdraw CO-001?",
      "Retira la CO-001",
      "Cancela la orden de cambio CO-001",
    ]
  ) {
    assertEquals(
      parseChangeOrderEdit(text),
      { changeOrderNumber: "CO-001", withdraw: true },
      text,
    );
  }
});

Deno.test("REQ-462 M26 parseChangeOrderEdit: a question, a new change order, two numbers or no change are not edits", () => {
  for (
    const text of [
      "Did Karen approve CO-001?",
      "What's the status of CO-001 ($1,200)?",
      "Did she cancel CO-001?",
      "Send CO-001 to Karen",
      "CO-001 looks good",
      'Tell Karen "thanks" about CO-001',
      "New change order like CO-001: towel bar $80",
      "Change order for Maria: add fridge cleaning $40",
      "Change Q-001 to $19,750",
      "CO-001 and CO-002 should both be $500",
      "Should I make CO-001 $1,000?",
      "",
    ]
  ) {
    assertEquals(parseChangeOrderEdit(text), undefined, text);
  }
});

Deno.test("REQ-462 changeOrderNumbersIn: every distinct CO number, upper-cased; CO-1 and CO-001 are one", () => {
  assertEquals(changeOrderNumbersIn("co-001, CO-1 and CO-002"), [
    "CO-001",
    "CO-002",
  ]);
  assertEquals(changeOrderNumbersIn("Q-001 only"), []);
});

Deno.test("REQ-462 editedChangeOrderDelta: an edited amount keeps the order's direction unless the contractor says credit / charge", () => {
  // a credit stays a credit
  assertEquals(
    editedChangeOrderDelta({
      currentCents: -8_000,
      amountCents: 5_000,
      userText: "make CO-002 $50",
    }),
    -5_000,
  );
  // the model's minus sign alone never flips an added-work order
  assertEquals(
    editedChangeOrderDelta({
      currentCents: 120_000,
      amountCents: -100_000,
      userText: "CO-001 should be 1000",
    }),
    100_000,
  );
  // said outright, the direction changes
  assertEquals(
    editedChangeOrderDelta({
      currentCents: 120_000,
      amountCents: 100_000,
      userText: "make CO-001 a $1,000 credit",
    }),
    -100_000,
  );
  assertEquals(
    editedChangeOrderDelta({
      currentCents: -8_000,
      amountCents: 5_000,
      userText: "make CO-002 a $50 charge instead",
    }),
    5_000,
  );
});

Deno.test("REQ-462 reconcileChangeOrderAmount: the model's new amount must be one typed, or the current one ± one typed; a slip is corrected, anything else asked", () => {
  // the amount typed
  assertEquals(
    reconcileChangeOrderAmount({
      amountCents: 100_000,
      currentCents: 120_000,
      userText: "CO-001 should be $1,000 instead of $1,200",
    }),
    { kind: "ok", amountCents: 100_000 },
  );
  // "knock $200 off" — current − typed
  assertEquals(
    reconcileChangeOrderAmount({
      amountCents: 100_000,
      currentCents: 120_000,
      userText: "knock $200 off CO-001",
    }),
    { kind: "ok", amountCents: 100_000 },
  );
  // a ×100 slip of the typed amount
  assertEquals(
    reconcileChangeOrderAmount({
      amountCents: 1_000,
      currentCents: 120_000,
      userText: "CO-001 is $1,000 now",
    }),
    { kind: "ok", amountCents: 100_000 },
  );
  // fits nothing typed
  assertEquals(
    reconcileChangeOrderAmount({
      amountCents: 77_700,
      currentCents: 120_000,
      userText: "CO-001 is $1,000 now",
    }),
    { kind: "ask" },
  );
  // nothing typed → it stands
  assertEquals(
    reconcileChangeOrderAmount({
      amountCents: 100_000,
      currentCents: 120_000,
      userText: "knock two hundred off CO-001",
    }),
    { kind: "ok", amountCents: 100_000 },
  );
});
