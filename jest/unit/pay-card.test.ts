/**
 * REQ-216 — the pay card's pure rules, ported from the CRM's charge island: the cells the card
 * prints, the mask, which cells changed (and so animate), the issuer mark's placement data and
 * the focus ring's transform.
 */
import {
  changedCells,
  expiryParts,
  focusOutlineStyle,
  focusZoneFor,
  holderCells,
  markAnchorOf,
  markStyle,
  numberCells,
} from "../../shared/payments/pay-card.ts";

describe("REQ-216 pay-card — the number cells", () => {
  test("16 digits print in 4-4-4-4 with the three spaces as cells; empty cells are #", () => {
    const cells = numberCells("4242", "visa", false);
    expect(cells).toHaveLength(19);
    expect(cells.join("")).toBe("4242 #### #### ####");
    expect(numberCells("4242424242424242", "visa", false).join("")).toBe(
      "4242 4242 4242 4242",
    );
  });
  test("the mask hides the middle eight while the number field is not focused — only digits that exist", () => {
    expect(numberCells("4242424242424242", "visa", true).join("")).toBe(
      "4242 **** **** 4242",
    );
    expect(numberCells("424242", "visa", true).join("")).toBe(
      "4242 **## #### ####",
    );
    expect(numberCells("", "none", true).join("")).toBe("#### #### #### ####");
  });
  test("Amex prints 4-6-5", () => {
    expect(numberCells("378282246310005", "amex", false).join("")).toBe(
      "3782 822463 10005",
    );
    expect(numberCells("378282246310005", "amex", true).join("")).toBe(
      "3782 ****** *0005",
    );
  });
});

describe("REQ-216 pay-card — holder, expiry, changes", () => {
  test("the holder prints one uppercase character per cell, 30 cells, blanks after", () => {
    const cells = holderCells("Ana Torres");
    expect(cells).toHaveLength(30);
    expect(cells.slice(0, 10).join("")).toBe("ANA TORRES");
    expect(cells[10]).toBe("");
    expect(holderCells("x".repeat(40))).toHaveLength(30);
  });
  test("the expiry halves: MM and YY, or the placeholders", () => {
    expect(expiryParts("12/34")).toEqual({ month: "12", year: "34" });
    expect(expiryParts("1")).toEqual({ month: "1", year: "YY" });
    expect(expiryParts("")).toEqual({ month: "MM", year: "YY" });
  });
  test("changed cells are the ones whose text differs and is not blank — those animate", () => {
    expect(changedCells(["4", "2", "#", " "], ["4", "2", "4", " "])).toEqual([
      2,
    ]);
    expect(changedCells(["A", "N"], ["A", ""])).toEqual([]);
    expect(changedCells(undefined, ["4", "2"])).toEqual([]);
  });
});

describe("REQ-216 pay-card — the issuer mark's placement is data (CRM REQ-033)", () => {
  test("an anchor the card cannot draw falls back to the card's own, right", () => {
    expect(markAnchorOf("top-right")).toBe("top-right");
    expect(markAnchorOf("sideways")).toBe("right");
    expect(markAnchorOf(undefined)).toBe("right");
  });
  test("size and opacity clamp; a value that would erase the mark falls back", () => {
    expect(markStyle(64, 80)).toBe(
      "--pc-mark-size: 64; --pc-mark-opacity: 80;",
    );
    expect(markStyle(undefined, undefined)).toBe(
      "--pc-mark-size: 92; --pc-mark-opacity: 42;",
    );
    expect(markStyle(0, -5)).toBe("--pc-mark-size: 92; --pc-mark-opacity: 42;");
    expect(markStyle(900, 300)).toBe(
      "--pc-mark-size: 140; --pc-mark-opacity: 100;",
    );
    expect(markStyle(5, 10)).toBe("--pc-mark-size: 20; --pc-mark-opacity: 10;");
  });
});

describe("REQ-216 pay-card — the focus ring", () => {
  test("the ring is a transform off the card-sized host box; the first placement does not travel", () => {
    const card = { left: 100, top: 50, width: 400, height: 250 };
    const zone = { left: 120, top: 150, width: 200, height: 50 };
    expect(focusOutlineStyle(card, zone, true)).toBe(
      "transition: none; transform: translate(20px, 100px) scale(0.5, 0.2); transform-origin: top left;",
    );
    expect(focusOutlineStyle(card, zone, false)).toBe(
      "transform: translate(20px, 100px) scale(0.5, 0.2); transform-origin: top left;",
    );
  });
  test("each field lights its zone; the CVC lights the expiry (the card is flipped anyway)", () => {
    expect(focusZoneFor("number")).toBe("number");
    expect(focusZoneFor("holder")).toBe("name");
    expect(focusZoneFor("expiry")).toBe("date");
    expect(focusZoneFor("cvc")).toBe("date");
    expect(focusZoneFor(undefined)).toBe("none");
  });
});
