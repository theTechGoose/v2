/**
 * REQ-302 — "fix every issue the demo found" (demo-loop cycle 1, issues B1 and
 * M29): a quote never carries a price that is not a price.
 *
 * RCA (demo-report r20a1d9c2, analyst + skeptic CONFIRMED at 4da03589):
 *   - "price abc" became one line at $0 and a draft with "Lock it in" offered
 *     (M29); "-500" became a -$500 line that could be locked and sent (B1).
 *     Nothing on the write path checked the sign or the zero: the parser only
 *     rejected non-finite numbers, the coordinator summed whatever it got, the
 *     DTO had no @Min, the store wrote the patch verbatim, lock/send never
 *     looked at the total, and the Lock button was disabled only on a missing
 *     quoteId.
 *   - The review card's TOTAL read `quote.estimatedTotal`, loaded once per
 *     quoteId, while its lines came from the locked card: after a chat
 *     reprice the lines said -$500 and the total said $0.00. The create_quote
 *     update-in-place reply carried no `quoteUpdated`, so the island never
 *     re-read the quote.
 *
 * The one rule, shared by the server and the island:
 *   a line is never negative, and the total is always above zero.
 */
import * as fs from "fs";
import * as path from "path";
import {
  quoteHasPrice,
  quotePriceProblem,
  storedQuotePriceProblem,
} from "../../shared/quote-flow/quote-price-guard";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-302 quote price guard (demo B1 + M29)", () => {
  test("M29: 'price abc' — a single $0 line is no price", () => {
    expect(quotePriceProblem([{ description: "Panel swap", amountCents: 0 }]))
      .toBe("no_total");
    expect(quoteHasPrice([{ description: "Panel swap", amountCents: 0 }], 0))
      .toBe(false);
  });

  test("B1: a negative line is refused even when the total is positive", () => {
    expect(
      quotePriceProblem([
        { description: "Labor", amountCents: 100_000 },
        { description: "Panel swap", amountCents: -50_000 },
      ]),
    ).toBe("negative_line");
    expect(
      quotePriceProblem([{ description: "Panel swap", amountCents: -50_000 }]),
    )
      .toBe("negative_line");
  });

  test("REQ-267's $0 'included' line stays legal when the quote has a total", () => {
    expect(
      quotePriceProblem([
        { description: "Interior walls", amountCents: 180_000 },
        { description: "Paint supplied by Castro Painting", amountCents: 0 },
      ]),
    ).toBeUndefined();
    expect(quoteHasPrice([{ description: "Roof", amountCents: 1 }])).toBe(true);
  });

  test("an explicit total wins over the lines, and a missing total means no price", () => {
    expect(quotePriceProblem([], 12_500)).toBeUndefined();
    expect(quotePriceProblem([], 0)).toBe("no_total");
    expect(quotePriceProblem([])).toBe("no_total");
    expect(quotePriceProblem([{ description: "x", amountCents: Number.NaN }]))
      .toBe("no_total");
  });

  test("a stored quote is judged on price × quantity and estimatedTotal", () => {
    expect(
      storedQuotePriceProblem({
        lineItems: [{ description: "x", quantity: 1, unit: "ea", price: -500 }],
        estimatedTotal: -500,
      }),
    ).toBe("negative_line");
    expect(
      storedQuotePriceProblem({
        lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 0 }],
        estimatedTotal: 0,
      }),
    ).toBe("no_total");
    expect(
      storedQuotePriceProblem({ lineItems: [], estimatedTotal: 12_500 }),
    ).toBeUndefined();
  });
});

describe("REQ-302 the chat island applies the guard", () => {
  const island = read("front-end/islands/AsstChat.tsx");

  test("'Lock it in' is disabled when the draft has no price", () => {
    expect(island).toMatch(/quote-price-guard/);
    // The draft card's lock button: disabled on a missing quoteId AND on a
    // priceless draft (was `disabled={sending || !payload.quoteId}`).
    expect(island).toMatch(
      /disabled=\{sending \|\| !payload\.quoteId \|\|\s*!quoteHasPrice\(lineItems, totalCents\)\}/,
    );
  });

  test("the review card's TOTAL is the sum of the lines it renders, not the stale quote.estimatedTotal", () => {
    expect(island).not.toMatch(
      /const totalCentsForBreakdown =\s*typeof quote\?\.estimatedTotal === "number"/,
    );
    expect(island).toMatch(
      /const totalCentsForBreakdown = lineItems\.length\s*\?\s*lineItems\.reduce\(/,
    );
  });
});

describe("REQ-302 the server side", () => {
  test("a create_quote that updates the bound draft flags the turn with quoteUpdated, like update_job_details does", () => {
    const hcm = read(
      "backend/src/agents/domain/coordinators/handle-chat-message/mod.ts",
    );
    // the update-in-place card carries the id so the island re-reads the quote
    expect(hcm).toMatch(/quoteUpdated: existingDraft\.id/);
    expect(hcm).toMatch(/quotePriceProblem\(/);
  });

  test("the ask-for-a-price reply exists in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(typeof en["chatCoordinator.priceMissing"]).toBe("string");
    expect(typeof es["chatCoordinator.priceMissing"]).toBe("string");
    expect(en["chatCoordinator.priceMissing"]).toContain("{item}");
    expect(es["chatCoordinator.priceMissing"]).toContain("{item}");
    expect(en["chatCoordinator.priceMissing"]).not.toBe(
      es["chatCoordinator.priceMissing"],
    );
  });
});
