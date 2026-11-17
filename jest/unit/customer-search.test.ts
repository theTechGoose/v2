/**
 * REQ-279 (demo M32) — customer search is accent-blind. The demo: in the assistant's
 * "Elige un cliente" picker, typing "Maria" did not find the saved "María José Peña" and the
 * panel offered 'Sin coincidencias. Crear "Maria"' — a duplicate customer one tap away.
 * Root cause (RCA M32): the picker (AsstChat.tsx) and GET /customers ?q= (clients-page
 * matchesQuery) both filtered with toLowerCase().includes(q) — no diacritic folding.
 * The fix: one shared rule, shared/quote-flow/customer-search.ts, used by both.
 */
import * as fs from "fs";
import * as path from "path";
import {
  customerMatchesQuery,
  foldSearch,
} from "../../shared/quote-flow/customer-search";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-279 (demo M32) customer search is accent-blind", () => {
  it("foldSearch strips accents, case and extra whitespace", () => {
    expect(foldSearch("  María   José PEÑA ")).toBe("maria jose pena");
    expect(foldSearch("Ñandú")).toBe("nandu");
  });

  it("'Maria' finds 'María José Peña' and 'María' finds 'Maria' — name, email, phone digits", () => {
    const maria = {
      name: "María José Peña",
      email: "mjp@example.com",
      phoneNumber: "+1 (843) 555-0101",
    };
    for (
      const q of ["Maria", "maria jose", "PENA", "María", "mjp@", "5550101", ""]
    ) {
      expect([q, customerMatchesQuery(maria, q)]).toEqual([q, true]);
    }
    expect(customerMatchesQuery({ name: "Maria Pena" }, "María Peña")).toBe(
      true,
    );
    expect(customerMatchesQuery(maria, "mario")).toBe(false);
  });

  it("the assistant's customer picker filters with the shared rule, not a raw toLowerCase().includes", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /from "\.\.\/\.\.\/shared\/quote-flow\/customer-search\.ts"/,
    );
    expect(src).toMatch(
      /\(customers \?\? \[\]\)\.filter\(\(c\) =>\s*customerMatchesQuery\(c, search\)/,
    );
    expect(src).not.toMatch(/c\.name\.toLowerCase\(\)\.includes\(q\)/);
  });

  it("the back end's matchesQuery (GET /customers ?q=, the /customers page) is the shared rule", () => {
    const src = read(
      "backend/src/analytics/domain/business/clients-page/mod.ts",
    );
    expect(src).toMatch(/#quote-flow\/customer-search\.ts/);
  });
});
