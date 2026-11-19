/**
 * REQ-924 — the customer workspace's front end: the sidebar's Customers context (which page rests in
 * it, the rows' order and status line), the top-bar search scoped to Customers (the open customer's
 * results first, a customer result opens her page), the route → island wiring, the client's paths,
 * and every `customerWs.*` string in both dictionaries.
 */
import * as fs from "fs";
import * as path from "path";
import {
  activeCustomerId,
  CUSTOMERS_CONTEXT,
  customerNavRows,
  isCustomersPage,
  shortMoney,
} from "../../front-end/lib/customer-nav";
import { scopeGroups, scopedUrl } from "../../front-end/lib/scoped-search";
import { restingPath } from "../../front-end/lib/sb-drawer";
import type { SearchHit } from "../../shared/documents/search";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;

describe("REQ-924 the sidebar's Customers context", () => {
  test("the customer pages rest in it; every other page rests where it did", () => {
    expect(isCustomersPage("customers")).toBe(true);
    expect(isCustomersPage("customer:abc")).toBe(true);
    expect(isCustomersPage("invoices")).toBe(false);
    expect(isCustomersPage(undefined)).toBe(false);
    expect(activeCustomerId("customer:abc")).toBe("abc");
    expect(activeCustomerId("customers")).toBeNull();
    expect(restingPath("customers")).toEqual([CUSTOMERS_CONTEXT]);
    expect(restingPath("customer:abc")).toEqual([CUSTOMERS_CONTEXT]);
    expect(restingPath("invoices")).toEqual(["billing"]);
    expect(restingPath("home")).toEqual([]);
  });

  test("rows: most overdue first, then most owed, then by name; the status line's kind and amount", () => {
    const subs = new Map([
      ["dc", [{ active: true, schedule: { en: "Every week · Tue", es: "Cada semana · mar" } }]],
      ["ml", [{ active: false, schedule: { en: "Every 2 weeks · Fri", es: "Cada 2 semanas · vie" } }]],
    ]);
    const rows = customerNavRows([
      { id: "tb", name: "Tom Bradley", balanceCents: 0 },
      { id: "cm", name: "Carlos Méndez", balanceCents: 640000, overdueCents: 0 },
      { id: "sj", name: "Sarah Johnson", balanceCents: 455000, overdueCents: 270000 },
      { id: "bp", name: "Bayside Property Mgmt", balanceCents: 158000, overdueCents: 158000 },
      { id: "dc", name: "David Chen", balanceCents: 0 },
      { id: "ml", name: "Maria Lopez", balanceCents: 0 },
      { id: "ab", name: "Abe Credit", balanceCents: -5000 },
    ], subs);
    expect(rows.map((r) => r.id)).toEqual(["sj", "bp", "cm", "ab", "dc", "ml", "tb"]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect([by.sj.tone, by.sj.amountCents]).toEqual(["late", 270000]);
    expect([by.cm.tone, by.cm.amountCents]).toEqual(["owes", 640000]);
    expect(by.dc.tone).toBe("rec");
    expect(by.dc.schedule).toEqual({ en: "Every week · Tue", es: "Cada semana · mar" });
    expect(by.ml.tone).toBe("paid"); // a paused service is not "recurring"
    expect(by.ab.tone).toBe("paid"); // a credit is nothing owed
    expect(by.sj.href).toBe("/customers/sj");
    expect(by.sj.initials).toBe("SJ");
    expect(by.bp.initials).toBe("BM"); // first + last word, as the sidebar's own initials
  });

  test("short money for the narrow rail: $980, $4.5k, $12k", () => {
    expect(shortMoney(98000)).toBe("$980");
    expect(shortMoney(455000)).toBe("$4.5k");
    expect(shortMoney(400000)).toBe("$4k");
    expect(shortMoney(1240000)).toBe("$12k");
    expect(shortMoney(0)).toBe("$0");
  });

  test("the sidebar renders the context: Back to the root, All customers, New customer, one row per customer", () => {
    expect(read("front-end/islands/DashSidebar.tsx")).toMatch(/CUSTOMERS_CONTEXT/);
    const src = read("front-end/components/CustomersNav.tsx");
    expect(src).toMatch(/data-cy="nav-customers-all"/);
    expect(src).toMatch(/data-cy="nav-customers-new"/);
    expect(src).toMatch(/data-cy="nav-customer-row"/);
    expect(src).toMatch(/customerNavRows\(/);
    expect(src).not.toMatch(/<input[^>]*nav-customers-search/); // no search box in the sidebar
  });
});

const hit = (over: Partial<SearchHit>): SearchHit => ({
  type: "invoice",
  id: "x",
  number: "INV-1",
  rank: 1,
  url: "/i/x",
  label: "x",
  related: [],
  version: 1,
  ...over,
} as SearchHit);

describe("REQ-924 the top-bar search, scoped to Customers", () => {
  const hits = [
    hit({ type: "customer", id: "c2", number: "C-002", url: "/customers?open=c2", customerId: "c2", customerName: "Bob" }),
    hit({ type: "invoice", id: "i1", customerId: "c1", customerName: "Ana", rank: 3 }),
    hit({ type: "invoice", id: "i2", customerId: "c2", customerName: "Bob", rank: 2 }),
    hit({ type: "quote", id: "q1", url: "/quotes?open=q1", customerId: "c1", customerName: "Ana" }),
    hit({ type: "customer", id: "c1", number: "C-001", url: "/customers?open=c1", customerId: "c1", customerName: "Ana" }),
  ];

  test("with an open customer, her results come first under one group, then the rest by type", () => {
    const g = scopeGroups(hits, { customerId: "c1" });
    expect(g.map((x) => x.key)).toEqual(["mine", "customer", "invoice"]);
    expect(g[0].hits.map((h) => h.id)).toEqual(["c1", "q1", "i1"]);
    expect(g[1].hits.map((h) => h.id)).toEqual(["c2"]);
    expect(g[2].hits.map((h) => h.id)).toEqual(["i2"]);
  });

  test("no open customer (the board) or no scope: the type groups only", () => {
    expect(scopeGroups(hits, {}).map((x) => x.key)).toEqual(["customer", "quote", "invoice"]);
    expect(scopeGroups(hits, null).map((x) => x.key)).toEqual(["customer", "quote", "invoice"]);
  });

  test("in the Customers context a customer result opens her page; outside it nothing changes", () => {
    expect(scopedUrl(hits[0], { customerId: "c1" })).toBe("/customers/c2");
    expect(scopedUrl(hits[0], null)).toBe("/customers?open=c2");
    expect(scopedUrl(hits[1], { customerId: "c1" })).toBe("/i/x");
  });

  test("the search takes the scope; the top bar passes it and can drop the greeting and the ticker", () => {
    const gs = read("front-end/islands/GlobalSearch.tsx");
    expect(gs).toMatch(/scope\?: SearchScope/);
    expect(gs).toMatch(/data-cy="global-search-scope"/);
    expect(gs).toMatch(/scopeGroups\(/);
    const tb = read("front-end/islands/DashTopbar.tsx");
    expect(tb).toMatch(/searchScope/);
    expect(tb).toMatch(/minimal/);
  });
});

describe("REQ-924 the page, its client, its strings", () => {
  test("/customers/<id> mounts the workspace in the shell, with the sidebar on that customer", () => {
    const route = read("front-end/routes/customers/[id].tsx");
    expect(route).toMatch(/CustomerWorkspace/);
    expect(route).toMatch(/active=\{`customer:\$\{/);
    expect(route).toMatch(/DashTopbar/);
    expect(route).toMatch(/minimal/);
    expect(fs.existsSync(path.join(ROOT, "front-end/static/customer-workspace.css"))).toBe(true);
  });

  test("the client asks the workspace, and Bill now pulls only this customer's visits", () => {
    const client = read("front-end/clients/customer-workspace.ts");
    expect(client).toMatch(/\/customers\/\$\{encodeURIComponent\(id\)\}\/workspace/);
    const field = read("front-end/clients/field.ts");
    expect(field).toMatch(/customerId\?: string/);
  });

  test("the actions reuse the app's flows", () => {
    const ws = read("front-end/islands/CustomerWorkspace.tsx");
    expect(ws).toMatch(/NewInvoiceModal/);
    expect(ws).toMatch(/PaymentReceivedForm/);
    // REQ-1031 (amends REQ-924(d)): Remind reuses the reminder nudge flow
    // (the /invoices card's "Send a nudge"), not the first-send sheet
    expect(ws).toMatch(/InvoiceNudgeDialog/);
    expect(ws).toMatch(/sendInvoiceNudge\(/);
    expect(ws).toMatch(/startConversation\(\{\s*customerId/);
    expect(ws).toMatch(/\/field\/subscriptions\?new=1&customerId=/);
    expect(ws).toMatch(/CustomerFormDialog/);
    expect(read("front-end/islands/InvoicesPage.tsx")).toMatch(/export function NewInvoiceModal/);
    expect(read("front-end/islands/FieldSubscriptionsPage.tsx")).toMatch(/customerId/);
  });

  test("every customerWs.* string the page and the sidebar use is in both dictionaries", () => {
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    const used = new Set<string>();
    for (const f of ["front-end/islands/CustomerWorkspace.tsx", "front-end/components/CustomersNav.tsx", "front-end/islands/GlobalSearch.tsx"]) {
      for (const m of read(f).matchAll(/["'`](customerWs\.[A-Za-z0-9_.]+)["'`]/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(30);
    const missing = [...used].filter((k) => !en[k] || !es[k]);
    expect(missing).toEqual([]);
  });
});

/**
 * REQ-989 (LOOP-007 q1, q1-72) — "Customer's Mensajes tab shows none of the emails sent to her". The
 * Messages tab must list her REQ-784 outbox entries (every email and text sent to her) whatever the
 * phone-line state: with no line, and with no phone on file. The "get a line" pitch only replaces the
 * compose box, never the history.
 */
describe("REQ-989 q1-72 the Messages tab lists what was sent to her", () => {
  const src = read("front-end/islands/CustomerWorkspace.tsx");
  const fn = src.slice(src.indexOf("function Messages("));
  const body = fn.slice(0, fn.indexOf("\nfunction ", 1) > 0 ? fn.indexOf("\nfunction ", 1) : undefined);

  test("REQ-989: the tab hands Messages the customer's id, not only her phone", () => {
    expect(src).toMatch(/<Messages\b[^>]*\bcustomerId=\{c\.id\}/);
  });

  test("REQ-989: her outbox entries are read by customer (GET /outbox?customerId=)", () => {
    const client = read("front-end/lib/outbox.ts") + read("front-end/islands/CustomerWorkspace.tsx");
    expect(client).toMatch(/outbox\?customerId=|["'`]customerId["'`]/);
    expect(body).toMatch(/outbox/i);
  });

  test("REQ-989: each entry renders as a row of the tab (cws-outbox-row)", () => {
    expect(body).toMatch(/data-cy="cws-outbox-row"/);
  });

  test("REQ-989: no line is not a dead end — the noLine branch never returns in place of the history", () => {
    expect(body).not.toMatch(/if \(state === "noLine"\)\s*\{\s*return/);
  });

  test("REQ-989: no phone on file is not a dead end either — the history still renders", () => {
    expect(body).not.toMatch(/if \(!peer\)\s*\{\s*return/);
  });
});
