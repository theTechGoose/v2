/** REQ-136 — the pure rules behind the SearchSelect island. */
import { assertEquals } from "@std/assert";
import {
  filterOptions,
  moveActive,
  type SearchOption,
} from "./search-select.ts";

const opts: SearchOption[] = [
  { id: "1", label: "Maria Lopez", hint: "Austin, TX" },
  { id: "2", label: "Omar Martinez" },
  { id: "3", label: "Ana María Pérez" },
  { id: "4", label: "Summary Roofing LLC" },
  { id: "5", label: "Zed Corp" },
];

Deno.test("REQ-136: an empty query lists the options in order, capped", () => {
  const r = filterOptions(opts, "", 3);
  assertEquals(r.items.map((o) => o.id), ["1", "2", "3"]);
  assertEquals(r.total, 5);
});

Deno.test("REQ-136: ranking — label start, then word start, then anywhere; non-matches drop", () => {
  const r = filterOptions(opts, "mar", 50);
  assertEquals(r.items.map((o) => o.id), ["1", "2", "3", "4"]);
  assertEquals(r.total, 4);
});

Deno.test("REQ-136: case and accents do not matter; the hint is searched too", () => {
  assertEquals(filterOptions(opts, "PÉREZ", 50).items.map((o) => o.id), ["3"]);
  assertEquals(filterOptions(opts, "perez", 50).items.map((o) => o.id), ["3"]);
  assertEquals(filterOptions(opts, "austin", 50).items.map((o) => o.id), ["1"]);
  assertEquals(filterOptions(opts, "nothing here", 50).items, []);
});

Deno.test("REQ-136: a thousand rows — the cap holds and total counts every match", () => {
  const many = Array.from(
    { length: 1000 },
    (_, i) => ({ id: String(i), label: `Row ${i}` }),
  );
  const r = filterOptions(many, "row", 50);
  assertEquals(r.items.length, 50);
  assertEquals(r.total, 1000);
  assertEquals(filterOptions(many, "row 99", 50).total, 11); // 99, 990..999
});

Deno.test("REQ-136: the highlight wraps at both ends and is -1 with no rows", () => {
  assertEquals(moveActive(0, 1, 3), 1);
  assertEquals(moveActive(2, 1, 3), 0);
  assertEquals(moveActive(0, -1, 3), 2);
  assertEquals(moveActive(-1, 1, 3), 0);
  assertEquals(moveActive(-1, -1, 3), 2);
  assertEquals(moveActive(1, 1, 0), -1);
});
