/** REQ-135 — the one set of rules a customers page is cut by: query, status, order, page, totals. */
import { assertEquals } from "#std/assert";
import type { CustomerCard } from "@crm/dto/customer.ts";
import { CLIENTS_FILTERS, CLIENTS_PAGE_SIZE, CLIENTS_PAGE_SIZE_MAX, clientsPage, countByStatus, loopPicks, matchesQuery, pageOf, sortByName, summarize } from "./mod.ts";

function card(over: Partial<CustomerCard>): CustomerCard {
  return {
    id: crypto.randomUUID(), userId: "u", name: "Zed", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    lastWhen: null, lastWhenRel: "", lastTone: "cold", balanceCents: 0, balanceSub: "", activeJobs: 0, jobsSub: "",
    status: "regular", temp: 0, daysSinceContact: 0, revenue12moCents: 0, documents: [], ...over,
  };
}

Deno.test("REQ-135 clients-page — pageOf: 25 a page by default, the page clamped to the pages there are, 100 at most", () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  assertEquals(CLIENTS_PAGE_SIZE, 25);
  assertEquals(CLIENTS_PAGE_SIZE_MAX, 100);
  const p1 = pageOf(items, 1, 25);
  assertEquals([p1.items.length, p1.page, p1.total, p1.totalPages], [25, 1, 30, 2]);
  const p2 = pageOf(items, 2, 25);
  assertEquals([p2.items.length, p2.items[0]], [5, 25]);
  assertEquals(pageOf(items, 9, 25).page, 2, "past the end is the last page");
  assertEquals(pageOf(items, 0, 25).page, 1, "below the start is the first");
  assertEquals(pageOf(items, 1, 1000).pageSize, 100, "capped");
  assertEquals(pageOf([], 1, 25).totalPages, 1, "an empty roster is one empty page");
});

Deno.test("REQ-135 clients-page — matchesQuery: name, business, email, phone digits, address, notes; case-insensitive; blank matches all", () => {
  const c = card({ name: "Jane Schwalm", businessName: "Acme HOA", email: "jane@example.com", phoneNumber: "(540) 434-0850", address: "213 Meadowbrook Rd", notes: "gate code 1234" });
  for (const q of ["jane", "ACME", "example.com", "5404340850", "434-0850", "meadowbrook", "gate code", ""]) assertEquals(matchesQuery(c, q), true, q);
  for (const q of ["bob", "9999"]) assertEquals(matchesQuery(c, q), false, q);
});

Deno.test("REQ-279 (demo M32) clients-page — matchesQuery is accent-blind both ways: 'maria' finds 'María José Peña', 'María' finds 'Maria'", () => {
  const maria = card({ name: "María José Peña", businessName: "Peña Jardinería", address: "12 Calle Ñandú", notes: "llamar después" });
  for (const q of ["maria", "MARIA JOSE", "jose pena", "pena jardineria", "calle nandu", "despues", "María", "  maría   josé "]) assertEquals(matchesQuery(maria, q), true, q);
  const plain = card({ name: "Maria Jose Pena" });
  for (const q of ["María", "maría josé peña", "PEÑA"]) assertEquals(matchesQuery(plain, q), true, q);
  assertEquals(matchesQuery(maria, "mario"), false, "still a real filter");
});

Deno.test("REQ-135 clients-page — sortByName is by name, case-insensitive, then by createdAt", () => {
  const a = card({ name: "alpha", createdAt: "2026-02-01T00:00:00Z" });
  const b = card({ name: "Alpha", createdAt: "2026-01-01T00:00:00Z" });
  const z = card({ name: "zed" });
  assertEquals(sortByName([z, a, b]).map((c) => c.createdAt + c.name), [b.createdAt + "Alpha", a.createdAt + "alpha", z.createdAt + "zed"]);
});

Deno.test("REQ-135 clients-page — countByStatus, summarize and loopPicks read the whole roster", () => {
  const cards = [
    card({ status: "active", activeJobs: 2 }), card({ status: "lead", daysSinceContact: 40 }), card({ status: "lead", daysSinceContact: 5 }),
    card({ status: "owes", balanceCents: 12_000, daysSinceContact: 90 }), card({ status: "owes", balanceCents: 3_000, daysSinceContact: 10 }),
    card({ status: "cold" }), card({ status: "regular" }),
  ];
  assertEquals(countByStatus(cards), { all: 7, new: 0, active: 1, lead: 2, owes: 2, regular: 1, cold: 1 });
  assertEquals(summarize(cards), { totalClients: 7, activeJobs: 1, owedCents: 15_000, quietCount: 1 });
  assertEquals(loopPicks(cards).map((c) => c.daysSinceContact), [90, 40, 10], "leads and owes, longest quiet first, three at most");
});

Deno.test("REQ-135 clients-page — clientsPage composes: q narrows the counts, status cuts the page, totals stay the roster's", () => {
  const cards = [
    ...Array.from({ length: 26 }, (_, i) => card({ name: `Lead ${String(i).padStart(2, "0")}`, status: "lead" })),
    card({ name: "Owes Olga", status: "owes", balanceCents: 500 }),
  ];
  const all = clientsPage(cards, { page: 2 });
  assertEquals([all.items.length, all.total, all.totalPages, all.summary.totalClients], [2, 27, 2, 27]);
  const leads = clientsPage(cards, { status: "lead" });
  assertEquals([leads.items.length, leads.total, leads.counts.lead, leads.counts.all], [25, 26, 26, 27]);
  const q = clientsPage(cards, { q: "olga", status: "all" });
  assertEquals([q.items.length, q.total, q.counts.all, q.counts.owes, q.summary.totalClients], [1, 1, 1, 1, 27]);
  assertEquals(q.loop.length, 3, "the loop is the roster's, never the query's");
});

Deno.test("REQ-271 clients-page — a new customer has its own chip: counted, filterable, never a regular", () => {
  const cards = [card({ status: "new" }), card({ status: "new" }), card({ status: "regular" })];
  assertEquals(CLIENTS_FILTERS.includes("new"), true);
  assertEquals(countByStatus(cards).new, 2);
  assertEquals(countByStatus(cards).regular, 1);
  assertEquals(clientsPage(cards, { status: "new" }).total, 2);
});
