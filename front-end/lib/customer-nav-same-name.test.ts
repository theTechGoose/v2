/**
 * REQ-1149 (LOOP-007 cycle 3, q3-80; amends REQ-924(a)) — two customers with the same name are
 * told apart in the sidebar. `customerNavRows` kept only id/name/initials/href, dropping the
 * card's `number` ("C-002"), `phoneNumber` and `email`, so two never-billed "Lupe Garza" rows were
 * identical ("LG Lupe Garza Nothing billed yet"). A row whose name (accent- and case-blind) is
 * shared by another row carries a `tag` — the customer number, else the phone, else the email —
 * and a unique name carries none. The order of same-name rows is stable (by number).
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { customerNavRows, type NavCard } from "./customer-nav.ts";

type Card = NavCard & { number?: string; phoneNumber?: string; email?: string };
const tagOf = (r: unknown) => (r as { tag?: string }).tag;

const CARDS: Card[] = [
  { id: "b", name: "Lupe Garza", balanceCents: 0, number: "C-002", phoneNumber: "+18435550142" },
  { id: "a", name: "Lupe Garza", balanceCents: 0, number: "C-001", phoneNumber: "+18435550111" },
  { id: "u", name: "Neo Unique", balanceCents: 0, number: "C-003" },
];

Deno.test("REQ-1149 (LOOP-007 q3, q3-80): two never-billed 'Lupe Garza' rows carry distinct tags (their customer numbers); a unique name carries none", () => {
  const rows = customerNavRows(CARDS as NavCard[]);
  const lupes = rows.filter((r) => r.name === "Lupe Garza");
  assertEquals(lupes.length, 2);
  assert(
    tagOf(lupes[0]) && tagOf(lupes[1]),
    `both same-name rows carry a tag (got ${JSON.stringify(lupes)})`,
  );
  assertNotEquals(tagOf(lupes[0]), tagOf(lupes[1]), "the tags tell the rows apart");
  assertEquals(
    new Set(lupes.map(tagOf)),
    new Set(["C-001", "C-002"]),
    "the tag is the customer's number",
  );
  assertEquals(tagOf(rows.find((r) => r.id === "u")), undefined, "a unique name gets no tag");
});

Deno.test("REQ-1149 (LOOP-007 q3, q3-80): same-name detection is accent- and case-blind; with no number the tag falls back to the phone, then the email", () => {
  const rows = customerNavRows([
    { id: "x", name: "María López", balanceCents: 0, phoneNumber: "+15125550199" },
    { id: "y", name: "maria lopez", balanceCents: 0, email: "maria@example.com" },
  ] as Card[] as NavCard[]);
  const x = tagOf(rows.find((r) => r.id === "x"));
  const y = tagOf(rows.find((r) => r.id === "y"));
  assert(x && /555.?0199/.test(x), `the first row's tag is her phone (got ${x})`);
  assertEquals(y, "maria@example.com", "the second row's tag is her email");
});

Deno.test("REQ-1149 (LOOP-007 q3, q3-80): same-name rows sort by number so the order is stable", () => {
  const rows = customerNavRows(CARDS as NavCard[]);
  assertEquals(
    rows.filter((r) => r.name === "Lupe Garza").map((r) => r.id),
    ["a", "b"],
    "C-001 before C-002 regardless of input order",
  );
});
