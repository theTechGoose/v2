/** REQ-136 AMENDMENT — "ana perez is in there a bunch of times." */
import { assertEquals } from "@std/assert";
import { demoRows } from "./search-select-demo.ts";

Deno.test("REQ-136: the dev page's thousand rows are a thousand different names", () => {
  const rows = demoRows();
  assertEquals(rows.length, 1000);
  assertEquals(new Set(rows.map((r) => r.label)).size, 1000);
  assertEquals(new Set(rows.map((r) => r.id)).size, 1000);
  assertEquals(rows.filter((r) => r.label === "Ana Pérez").length <= 1, true);
});
