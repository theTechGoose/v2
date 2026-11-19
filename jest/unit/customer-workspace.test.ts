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

  test("REQ-924/REQ-1041 the rail's amount is the exact balance: $980, $4,550, $12,400", () => {
    expect(shortMoney(98000)).toBe("$980");
    expect(shortMoney(455000)).toBe("$4,550");
    expect(shortMoney(400000)).toBe("$4,000");
    expect(shortMoney(1240000)).toBe("$12,400");
    expect(shortMoney(175025)).toBe("$1,750.25");
    expect(shortMoney(0)).toBe("$0");
  });

  /** the dollar figure a sidebar amount claims ("$1,750" → 1750, "$1.8k" → 1800) */
  const claimedDollars = (s: string): number => {
    const m = s.match(/^\$([\d,]+(?:\.\d+)?)(k?)$/);
    if (!m) throw new Error(`not a money string: ${s}`);
    const n = Number(m[1].replace(/,/g, ""));
    return m[2] === "k" ? n * 1000 : n;
  };

  test("REQ-1041 (LOOP-007 q2-25): the sidebar's owed amount is the exact amount, as the KPI shows it — $1,750 owed reads \"$1,750\", never \"$1.8k\"", () => {
    expect(shortMoney(175000)).toBe("$1,750");
    expect(shortMoney(175000)).not.toBe("$1.8k");
    expect(shortMoney(99960)).not.toBe("$1k");
    expect(shortMoney(1550000)).not.toBe("$16k");
  });

  test("REQ-1041 (LOOP-007 q2-25): the sidebar never shows more than the customer owes, over a sweep of amounts", () => {
    const over: string[] = [];
    for (let cents = 0; cents <= 5_000_000; cents += 2_537) {
      const shown = shortMoney(cents);
      if (claimedDollars(shown) > cents / 100) over.push(`${cents}¢ → ${shown}`);
    }
    for (const cents of [175000, 175099, 99960, 1050000, 1550000]) {
      const shown = shortMoney(cents);
      if (claimedDollars(shown) > cents / 100) over.push(`${cents}¢ → ${shown}`);
    }
    expect(over.slice(0, 8)).toEqual([]);
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

/**
 * REQ-1076 (LOOP-007 q2, q2-64) — "Send a message" on an email-only customer is a dead end. More →
 * Send a text lands on the Messages tab, whose no-phone card was plain text: no way to add the phone
 * (the edit dialog is on the same page) and no way to email her. The no-phone card must offer an
 * add-phone action wired to the edit dialog, and an email action when she has an email; the More item
 * must not promise a generic "message" in Spanish while it only opens the text thread.
 */
describe("REQ-1076 q2-64 the no-phone Messages card is not a dead end", () => {
  const src = read("front-end/islands/CustomerWorkspace.tsx");
  const fn = src.slice(src.indexOf("function Messages("));
  const body = fn.slice(0, fn.indexOf("\nfunction ", 1) > 0 ? fn.indexOf("\nfunction ", 1) : undefined);
  const noPeerStart = body.indexOf("if (!peer) {");
  const noPeer = body.slice(noPeerStart, body.indexOf("} else if", noPeerStart));
  const call = (src.match(/<Messages\b[\s\S]*?\/>/) ?? [""])[0];
  const en = dict("lang/en.json");
  const es = dict("lang/es.json");

  test("REQ-1076: the no-phone branch exists (sanity)", () => {
    expect(noPeerStart).toBeGreaterThan(-1);
    expect(noPeer).toMatch(/data-cy="cws-msg-nophone"/);
  });

  test("REQ-1076: the no-phone card renders an add-phone control (data-cy=\"cws-msg-addphone\")", () => {
    expect(noPeer).toMatch(/data-cy="cws-msg-addphone"/);
  });

  test("REQ-1076: the add-phone control calls a callback the workspace wires to the edit dialog", () => {
    expect(noPeer).toMatch(/onClick=\{[^}]*onAddPhone/);
    expect(call).toMatch(/onAddPhone=\{\s*\(\)\s*=>\s*setModal\(\{\s*kind:\s*"edit"\s*\}\)\s*\}/);
  });

  test("REQ-1076: the workspace hands Messages the customer's email, and the no-phone card offers to email her", () => {
    expect(call).toMatch(/\bemail=\{c\.email\}/);
    expect(noPeer).toMatch(/data-cy="cws-msg-email"/);
  });

  test("REQ-1076: both dictionaries carry customerWs.msg.addPhone and customerWs.msg.email", () => {
    for (const d of [en, es]) {
      expect(typeof d["customerWs.msg.addPhone"]).toBe("string");
      expect(typeof d["customerWs.msg.email"]).toBe("string");
    }
  });

  test("REQ-1076: the Spanish More item says it sends a TEXT (like en \"Send a text\"), or the item is gated on a phone", () => {
    const gated = /phoneNumber\s*&&[\s\S]{0,200}customerWs\.act\.text/.test(src);
    expect(gated || /texto/i.test(es["customerWs.act.text"])).toBe(true);
  });
});

/**
 * REQ-1108 (LOOP-007 q3, q3-33) — More → "Send a text" with no phone line is a dead end or does nothing
 * visible. The More item was always "💬 Send a text" with `onClick={() => setTab("messages")}`: it never
 * asked whether the business has a line (only the Messages child does, after it mounts) nor whether the
 * customer has a phone, and the click only swapped the tab body, which opens below the KPI grid, out of
 * view (no scroll, no focus). The item's label/target must follow the line + phone facts, and the
 * Send-a-text path must scroll the Messages body into view and focus the composer.
 */
describe("REQ-1108 q3-33 More → Send a text follows the line and the phone, and lands visibly", () => {
  const src = read("front-end/islands/CustomerWorkspace.tsx");
  const ws = src.slice(0, src.indexOf("function Messages("));
  const menuStart = ws.indexOf('data-cy="cws-menu"');
  const menu = ws.slice(menuStart, ws.indexOf('data-cy="cws-start-service"', menuStart));
  const en = dict("lang/en.json");
  const es = dict("lang/es.json");

  test("REQ-1108: the menu block is found (sanity)", () => {
    expect(menuStart).toBeGreaterThan(-1);
    expect(menu).toMatch(/customerWs\.act\.text/);
  });

  test("REQ-1108: the workspace itself looks up the business's line (commsClient.line), not only the Messages tab", () => {
    expect(ws).toMatch(/commsClient\.line\(/);
  });

  test("REQ-1108: with no line the More item reads customerWs.act.getLineToText and links to /communications", () => {
    expect(menu).toMatch(/customerWs\.act\.getLineToText/);
    expect(menu).toMatch(/href=\{?["'`]\/communications/);
  });

  test("REQ-1108: with a line but no customer phone the More item reads customerWs.act.addPhoneToText and opens the edit dialog", () => {
    expect(menu).toMatch(/phoneNumber/);
    expect(menu).toMatch(/customerWs\.act\.addPhoneToText/);
  });

  test("REQ-1108: the Send-a-text path scrolls the tab body into view and focuses the composer", () => {
    expect(menu).not.toMatch(/onClick=\{\(\)\s*=>\s*setTab\("messages"\)\}/);
    expect(src).toMatch(/scrollIntoView\(/);
    expect(src).toMatch(/\.focus\(/);
  });

  test("REQ-1108: en and es carry customerWs.act.getLineToText and customerWs.act.addPhoneToText", () => {
    for (const d of [en, es]) {
      expect(typeof d["customerWs.act.getLineToText"]).toBe("string");
      expect(typeof d["customerWs.act.addPhoneToText"]).toBe("string");
    }
    expect(en["customerWs.act.getLineToText"]).toMatch(/line/i);
    expect(en["customerWs.act.addPhoneToText"]).toMatch(/phone/i);
  });
});
