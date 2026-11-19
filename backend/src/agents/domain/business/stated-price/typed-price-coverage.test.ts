/**
 * REQ-1023 (LOOP-007 cycle 2, q2-3) — a first draft keeps every priced item
 * the contractor typed.
 *
 * Q-002 (fleet-r66a3e3fc-1 stdout:29/36): the contractor typed "…mano de obra
 * 4200 materiales 1350. 50% de anticipo. y tambien arreglar la cerca de
 * madera 18 pies lineales $900". The model's create_quote had labor $4,200 +
 * fence $900 = $5,100 and dropped the $1,350 materials; nothing noticed,
 * because `moneyAmounts` reads only "$900" out of that message (a bare
 * labelled "4200" / "1350" carries no "$", currency word or k/mil), and
 * `settleCreateQuote` returned "keep".
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import * as money from "#quote-flow/money-amounts.ts";
import { type PricedLine, settleCreateQuote, statedTotalCents } from "./mod.ts";

/** The tester's message #4, as the RCA reconstructed it (the "…" elision is
 *  the job's paint details). */
const Q2_3_MSG =
  "cotizacion para jorge ramirez tel 843 555 2290, 905 calle del sol san antonio tx 78207. pintar la casa por fuera, 2 manos, color beige. mano de obra 4200 materiales 1350. 50% de anticipo. y tambien arreglar la cerca de madera 18 pies lineales $900";

/** The model's $5,100 draft: labor + fence, no materials. */
const DRAFT_5100: PricedLine[] = [
  {
    description:
      "Pintar la casa por fuera, 2 manos, color beige (mano de obra)",
    amountCents: 420_000,
  },
  {
    description: "Arreglar la cerca de madera (18 pies lineales)",
    amountCents: 90_000,
  },
];

const sum = (ls: readonly PricedLine[]) =>
  ls.reduce((s, l) => s + l.amountCents, 0);

type Labelled = { cents: number }[];
const labelledAmounts = (
  money as unknown as { labelledAmounts?: (s: string) => Labelled }
).labelledAmounts;

Deno.test("REQ-1023 q2-3 labelledAmounts: the Q-002 message reads labor 4200, materiales 1350 and the $900 fence — never the phone, street, zip or the 18 feet", () => {
  assert(
    typeof labelledAmounts === "function",
    "shared/quote-flow/money-amounts.ts exports labelledAmounts(text)",
  );
  const cents = labelledAmounts!(Q2_3_MSG).map((a) => a.cents);
  for (const want of [420_000, 135_000, 90_000]) {
    assert(
      cents.includes(want),
      `reads ${want} — got ${JSON.stringify(cents)}`,
    );
  }
  for (const never of [84_300, 55_500, 229_000, 90_500, 7_820_700, 1_800]) {
    assert(
      !cents.includes(never),
      `never reads ${never} — got ${JSON.stringify(cents)}`,
    );
  }
});

Deno.test("REQ-1023 q2-3 labelledAmounts: 'materials: 1,350' and 'falta el material de 1350' are read; a bare quantity is not", () => {
  assert(
    typeof labelledAmounts === "function",
    "shared/quote-flow/money-amounts.ts exports labelledAmounts(text)",
  );
  assertEquals(
    labelledAmounts!("labor 4200, materials: 1,350").map((a) => a.cents),
    [420_000, 135_000],
  );
  assertEquals(
    labelledAmounts!("falta el material de 1350").map((a) => a.cents),
    [135_000],
  );
  assertEquals(labelledAmounts!("paint 2 rooms, 3 coats, 18 pies"), []);
});

Deno.test("REQ-1023 q2-3 statedTotalCents: a bare labelled 'total 5,550' is the job's total", () => {
  assertEquals(
    statedTotalCents("mano de obra 4200 materiales 1350 total 5,550"),
    555_000,
  );
});

Deno.test("REQ-1023 q2-3 settleCreateQuote: the $5,100 first draft that drops the typed materiales 1350 is re-asked naming it, and saved at $6,450 with a $1,350 materials line when the model still leaves it out", async () => {
  const notes: string[] = [];
  const out = await settleCreateQuote({
    payload: {
      summary: "Pintura exterior — Jorge Ramirez",
      lineItems: DRAFT_5100,
    },
    userText: Q2_3_MSG,
    lang: "es",
    reask: (turns) => {
      notes.push(turns[turns.length - 1].content);
      return Promise.resolve(DRAFT_5100);
    },
  });
  assertEquals(out.kind, "save", `got ${JSON.stringify(out)}`);
  if (out.kind !== "save") return;
  const amounts = out.payload.lineItems.map((l) => l.amountCents);
  assert(amounts.includes(135_000), `a $1,350 line — got ${amounts}`);
  assert(amounts.includes(420_000), `labor stays $4,200 — got ${amounts}`);
  assert(amounts.includes(90_000), `fence stays $900 — got ${amounts}`);
  assertEquals(sum(out.payload.lineItems), 645_000);
  const mat = out.payload.lineItems.find((l) => l.amountCents === 135_000)!;
  assert(/materia/i.test(mat.description), mat.description);
  assert(
    notes.length >= 1,
    "the model is re-asked once about the missing line",
  );
  assertStringIncludes(notes[0].toLowerCase(), "materiales");
  assertStringIncludes(notes[0], "1,350");
});

Deno.test("REQ-1023 q2-3 settleCreateQuote: a re-ask that adds the materiales line is saved as the model wrote it", async () => {
  const fixed: PricedLine[] = [
    ...DRAFT_5100,
    { description: "Materiales (pintura y suministros)", amountCents: 135_000 },
  ];
  const out = await settleCreateQuote({
    payload: {
      summary: "Pintura exterior — Jorge Ramirez",
      lineItems: DRAFT_5100,
    },
    userText: Q2_3_MSG,
    lang: "es",
    reask: () => Promise.resolve(fixed),
  });
  assertEquals(out.kind, "save", `got ${JSON.stringify(out)}`);
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems, fixed);
});

Deno.test("REQ-1023 q2-3 settleCreateQuote: a draft that already bills labor, materiales and the fence is kept, no re-ask", async () => {
  let asked = 0;
  const out = await settleCreateQuote({
    payload: {
      summary: "Pintura exterior — Jorge Ramirez",
      lineItems: [
        ...DRAFT_5100,
        { description: "Materiales", amountCents: 135_000 },
      ],
    },
    userText: Q2_3_MSG,
    lang: "es",
    reask: () => {
      asked++;
      return Promise.resolve(undefined);
    },
  });
  assertEquals(out.kind, "keep");
  assertEquals(asked, 0);
});
