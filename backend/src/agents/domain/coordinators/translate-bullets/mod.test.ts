import { assertEquals } from "#std/assert";
import { droppedLines } from "./mod.ts";

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
