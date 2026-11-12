import { assertEquals } from "#std/assert";
import { droppedLines, suspectLines } from "./mod.ts";

// REQ-410 (demo-loop cycle 2, M24): the content guard that keeps a
// translation from silently dropping an exclusion / who-supplies-what clause.
Deno.test("REQ-410 M24 droppedLines: the demo's faucet line that lost its parenthetical is flagged", () => {
  assertEquals(
    droppedLines(
      [
        "60in double vanity, quartz top, 2 undermount sinks (faucets supplied by client / grifos los pone la clienta)",
      ],
      ["Mueble de baño de 60in, encimera de cuarzo, 2 lavabos bajo encimera"],
    ),
    [0],
  );
});

Deno.test("REQ-410 M24 droppedLines: a faithful translation with its parenthetical passes", () => {
  assertEquals(
    droppedLines(
      ["2 undermount sinks (faucets supplied by client)"],
      ["2 lavabos bajo encimera (grifos suministrados por el cliente)"],
    ),
    [],
  );
});

Deno.test("REQ-410 M24 droppedLines: an un-parenthesised exclusion cut short is flagged, both directions", () => {
  assertEquals(
    droppedLines(["Install toilet, supplied by owner, haul-off not included"], [
      "Instalar inodoro",
    ]),
    [0],
  );
  assertEquals(
    droppedLines([
      "Instalar inodoro, suministrado por el dueño, retiro no incluido",
    ], [
      "Install toilet",
    ]),
    [0],
  );
});

Deno.test("REQ-410 M24 droppedLines: plain lines are never judged on length", () => {
  assertEquals(droppedLines(["Paint the walls and ceiling"], ["Pintar"]), []);
});

// REQ-669 (demo-loop cycle 5, m52): the first Spanish preview read "Guttar
// baño principal 8x10" (an English stem with a Spanish verb ending) and
// "Agregar mueble de baño con encimera de cuarzo" for "Add double vanity w/
// quartz top" (lost "doble"). suspectLines flags both so the model re-asks.
Deno.test("REQ-669 m52 suspectLines: an English stem with a Spanish ending (Guttar) is flagged", () => {
  const issues = suspectLines(
    ["Gut master bath 8x10", "Install exhaust fan"],
    ["Guttar baño principal 8x10", "Instalar extractor de baño"],
    "es",
  );
  assertEquals(issues.map((i) => i.line), [0]);
  assertEquals(issues[0].coined, ["Guttar"]);
});

Deno.test("REQ-669 m52 suspectLines: other coinages on an English stem (tilear, groutear, gutteado) are flagged", () => {
  const issues = suspectLines(
    ["Tile shower walls", "Grout floor", "Gut kitchen"],
    ["Tilear paredes de la ducha", "Groutear el piso", "Cocina gutteada"],
    "es",
  );
  assertEquals(issues.map((i) => i.line), [0, 1, 2]);
});

Deno.test("REQ-669 m52 suspectLines: a lost quantity adjective (double → doble) is flagged", () => {
  const issues = suspectLines(
    ["Add double vanity w/ quartz top"],
    ["Agregar mueble de baño con encimera de cuarzo"],
    "es",
  );
  assertEquals(issues.map((i) => i.line), [0]);
  assertEquals(issues[0].lostQuantities, ["double"]);
});

Deno.test("REQ-669 m52 suspectLines: a lost number (8x10) is flagged", () => {
  const issues = suspectLines(
    ["Gut master bath 8x10"],
    ["Desmantelar baño principal"],
    "es",
  );
  assertEquals(issues[0]?.lostQuantities, ["8", "10"]);
});

Deno.test("REQ-669 m52 suspectLines: the good re-translation and real Spanish cognates pass", () => {
  assertEquals(
    suspectLines(
      [
        "Gut master bath 8x10",
        "Add double vanity w/ quartz top",
        "Install exhaust fan",
        "Plant shrubs and form concrete pad",
        "Visit site, limit dust",
        "Paint 2 bedrooms",
      ],
      [
        "Desmantelar baño principal 8×10",
        "Agregar mueble de baño doble con encimera de cuarzo",
        "Instalar extractor",
        "Plantar arbustos y formar losa de concreto",
        "Visitar el sitio, limitar el polvo",
        "Pintar dos recámaras",
      ],
      "es",
    ),
    [],
  );
});

Deno.test("REQ-669 m52 suspectLines: to English, a lost doble is flagged and coinage is not judged", () => {
  const issues = suspectLines(
    ["Agregar mueble de baño doble"],
    ["Add vanity"],
    "en",
  );
  assertEquals(issues.map((i) => i.lostQuantities), [["doble"]]);
});
