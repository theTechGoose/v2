/**
 * REQ-438 (demo-loop cycle 3, M7) — the assistant answers in the language
 * the contractor TYPED. Pair 6's app was in English and they typed Spanish;
 * every reply came back in English. `messageLang` reads es / en from one
 * message; undefined means "can't tell" (the app language then decides).
 */
import { assertEquals } from "#std/assert";
import { messageLang } from "./mod.ts";

Deno.test("REQ-438 M7 messageLang: the demo's Spanish messages read es", () => {
  for (
    const s of [
      "Cotización para María José Peña: cambiar la llave del fregadero de la cocina, $180 todo incluido.",
      "No es change order, es una cotización NUEVA para María José Peña, $180.",
      "No, el trabajo es solo de $180. Borra la factura repetida INV-001 por favor.",
      "¿Cuánto me debe Ana López?",
      "agrega limpieza del refri $40",
    ]
  ) assertEquals(messageLang(s), "es", s);
});

Deno.test("REQ-438 M7 messageLang: English reads en — Spanish names in it don't flip it", () => {
  for (
    const s of [
      "Quote for María José Peña: replace the kitchen faucet, $180 all in.",
      "Change order for Maria: add fridge cleaning $40",
      "Delete invoice INV-002 please",
      "how much does Ana owe me?",
      "Dana wants a tile backsplash too, so Q-001 comes out at $19,750",
    ]
  ) assertEquals(messageLang(s), "en", s);
});

Deno.test("REQ-438 M7 messageLang: too short or mixed to tell → undefined (the app language decides)", () => {
  for (
    const s of [
      "ok",
      "sí",
      "yes",
      "dale",
      "$180",
      "Q-001",
      "",
      "María José Peña",
    ]
  ) assertEquals(messageLang(s), undefined, s);
});
