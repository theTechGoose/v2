/**
 * REQ-438 (demo-loop cycle 3, M7) — "Borra la factura repetida INV-001" is a
 * request to delete an invoice. The chat had no invoice tool, so the model
 * squeezed it into change_order and pair 1 got "¿Cuánto debe sumar Eliminar
 * factura INV-001 a Q-001…?". These are the pure rules for reading it.
 */
import { assertEquals } from "#std/assert";
import { parseInvoiceRemoval } from "./mod.ts";

Deno.test("REQ-438 M7 parseInvoiceRemoval: the demo's sentence is a delete of INV-001", () => {
  assertEquals(
    parseInvoiceRemoval(
      "No, el trabajo es solo de $180. Borra la factura repetida INV-001 por favor.",
    ),
    { invoiceNumber: "INV-001" },
  );
});

Deno.test("REQ-438 M7 parseInvoiceRemoval: delete / void / cancel an invoice, in English and Spanish", () => {
  const cases: [string, string | undefined][] = [
    ["Delete invoice INV-002", "INV-002"],
    ["please void INV-3", "INV-3"],
    ["cancel the duplicate invoice", undefined],
    ["get rid of that invoice INV-001", "INV-001"],
    ["elimina la factura INV-004", "INV-004"],
    ["anula la factura duplicada", undefined],
    ["bórrala, la factura inv-001 está repetida", "INV-001"],
    ["Borra INV-010", "INV-010"],
  ];
  for (const [s, n] of cases) {
    assertEquals(
      parseInvoiceRemoval(s),
      n ? { invoiceNumber: n } : {},
      s,
    );
  }
});

Deno.test("REQ-438 M7 parseInvoiceRemoval: a line removed FROM an invoice, a change order, or billing is not a delete", () => {
  for (
    const s of [
      "remove the deposit line from the invoice",
      "borra la línea de la factura",
      "send him the deposit invoice",
      "mándale la factura a Ana",
      "Change order for Maria: remove fridge cleaning $40",
      "delete the tile line from Q-001",
      "how much does Ana owe on INV-001?",
    ]
  ) assertEquals(parseInvoiceRemoval(s), undefined, s);
});
