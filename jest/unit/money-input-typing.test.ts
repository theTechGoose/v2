/**
 * REQ-280 — fix every issue the demo found; this one is demo issue M33: "Typed text in the amount
 * field gets reversed in the hidden input ('-50abc' shows $50.00, input value '50cba')".
 *
 * MoneyInput's <input> is controlled (value={display}) and transparent. The browser puts each
 * keystroke into the field; the island formats it and sets state; Preact writes the value back
 * ONLY when that state changed. A letter after "50" formats to "50" again — no change, no render —
 * so the letter stayed in the field, and the caret, put back after the two digits, sat in front of
 * it: the next letter landed before the last. The fix: typeMoney writes the formatted text back
 * into the field itself on every keystroke.
 */
import {
  formatTyping,
  parseToCents,
  typeMoney,
} from "../../front-end/lib/money-input";

/** An <input> the browser types into, wired the way MoneyInput wires it: typeMoney on each input
 *  event, then Preact's controlled-value write — which only happens when `display` changed. */
function moneyField() {
  const el = { value: "", selectionStart: 0 as number | null };
  let display = "";
  let cents: number | null = null;
  let rejected: string | null = null;
  return {
    el,
    get display() {
      return display;
    },
    get cents() {
      return cents;
    },
    get rejected() {
      return rejected;
    },
    /** one keystroke at the caret, as a browser does it */
    type(ch: string) {
      const at = el.selectionStart ?? el.value.length;
      el.value = el.value.slice(0, at) + ch + el.value.slice(at);
      el.selectionStart = at + ch.length;
      const r = typeMoney(el);
      if (r.formatted !== display) el.value = r.formatted; // Preact re-renders only on a change
      display = r.formatted;
      cents = r.cents;
      rejected = r.rejected;
      el.selectionStart = r.caret;
    },
    typeAll(s: string) {
      for (const ch of s) this.type(ch);
    },
  };
}

describe("REQ-280 (demo M33): MoneyInput keeps the field's text equal to the amount shown", () => {
  test("REQ-280: typing '-50abc' leaves the field holding '50', $50.00, the caret at the end", () => {
    const f = moneyField();
    f.typeAll("-50abc");
    expect(f.el.value).toBe("50");
    expect(f.display).toBe("50");
    expect(f.cents).toBe(5000);
    expect(f.el.selectionStart).toBe(2);
    // REQ-680 (demo M25/m62, cycle 5): still stripped, no longer silent
    expect(f.rejected).toBe("letters");
    f.type("7");
    expect(f.rejected).toBeNull();
  });

  test("REQ-280: after every keystroke the field holds exactly what the odometer shows", () => {
    const f = moneyField();
    for (const ch of "x1a2,3b4.5c6d7-") {
      f.type(ch);
      expect(f.el.value).toBe(f.display);
    }
    expect(f.el.value).toBe("1,234.56");
    expect(f.cents).toBe(123456);
  });

  test("REQ-280: a letter typed into the middle is dropped and the caret stays where it was", () => {
    const f = moneyField();
    f.typeAll("1234");
    f.el.selectionStart = 2; // "1,|234" — after the "1" and the comma
    f.type("z");
    expect(f.el.value).toBe("1,234");
    expect(f.el.selectionStart).toBe(1); // back right after the "1", where the letter went in
    f.type("9");
    expect(f.el.value).toBe("19,234");
    expect(f.cents).toBe(1923400);
  });

  test("REQ-280: typeMoney writes the formatted value into the field itself", () => {
    const el = { value: "50cba", selectionStart: 2 };
    const r = typeMoney(el);
    // REQ-680 (demo m62, cycle 5): and it says it dropped letters, for MoneyInput's note
    expect(r).toEqual({
      formatted: "50",
      cents: 5000,
      caret: 2,
      rejected: "letters",
    });
    expect(el.value).toBe("50");
  });

  test("REQ-280: the formatting it relies on is unchanged", () => {
    expect(formatTyping("-50abc")).toBe("50");
    expect(formatTyping("0012345.678")).toBe("12,345.67");
    expect(parseToCents("1,234.5")).toBe(123450);
    expect(parseToCents("")).toBeNull();
  });
});
