/**
 * REQ-302 (demo-loop cycle 1, B1 + M29) — the quote DTOs refuse a price that
 * is not a price: a negative line, or a total at or below zero. Before this
 * the only checks were @IsNumber (paperwork/dto/quote.ts had no @Min), so
 * "price abc" → $0 and "-500" → -$500 both validated.
 */
// class-validator decorators need the Reflect polyfill the app boots with
import "#reflect-metadata";
import { assertEquals, assertThrows } from "#std/assert";
import { parseCreateQuote, parseUpdateQuote } from "./quote.ts";

Deno.test("REQ-302 DTO: a negative line price is rejected on create and update", () => {
  assertThrows(() =>
    parseCreateQuote({
      summary: "Panel swap",
      lineItems: [{
        description: "Panel swap",
        quantity: 1,
        unit: "ea",
        price: -50_000,
      }],
      estimatedTotal: -50_000,
    })
  );
  assertThrows(() =>
    parseUpdateQuote({
      lineItems: [{
        description: "Panel swap",
        quantity: 1,
        unit: "ea",
        price: -1,
      }],
    })
  );
});

Deno.test("REQ-302 DTO: an estimatedTotal of zero or less is rejected on create and update", () => {
  assertThrows(() =>
    parseCreateQuote({
      summary: "Panel swap",
      lineItems: [{
        description: "Panel swap",
        quantity: 1,
        unit: "ea",
        price: 0,
      }],
      estimatedTotal: 0,
    })
  );
  assertThrows(() => parseUpdateQuote({ estimatedTotal: 0 }));
  assertThrows(() => parseUpdateQuote({ estimatedTotal: -500 }));
});

Deno.test("REQ-302 DTO: a $0 'included' line with a positive total still validates (REQ-267)", () => {
  const dto = parseCreateQuote({
    summary: "Interior repaint",
    lineItems: [
      {
        description: "Interior walls",
        quantity: 1,
        unit: "ea",
        price: 180_000,
      },
      {
        description: "Paint supplied by Castro Painting",
        quantity: 1,
        unit: "ea",
        price: 0,
      },
    ],
    estimatedTotal: 180_000,
  });
  assertEquals(dto.estimatedTotal, 180_000);
  assertEquals(parseUpdateQuote({ estimatedTotal: 1 }).estimatedTotal, 1);
});
