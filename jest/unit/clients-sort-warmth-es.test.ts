/**
 * REQ-718 (demo-loop cycle 5, issue p18-1b): the /customers sort "Warmth"
 * orders by lead warmth / interest. Spanish said "Cercanía" ("nearness"),
 * which misleads; it must read "Interés".
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-718 clients sort-by-warmth label (cycle 5, p18-1b)", () => {
  it("REQ-718 es labels the warmth sort 'Interés', not 'Cercanía'", () => {
    expect(es["clientsBoard.sort.warmth"]).toBe("Interés");
  });
  it("REQ-718 no Spanish string uses 'Cercanía' for warmth", () => {
    expect(Object.values(es).filter((v) => /cercan[ií]a/i.test(v))).toEqual([]);
  });
  it("REQ-718 en keeps 'Warmth' (both dictionaries carry the key)", () => {
    expect(en["clientsBoard.sort.warmth"]).toBe("Warmth");
  });
});
