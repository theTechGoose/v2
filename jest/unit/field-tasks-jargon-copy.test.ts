/**
 * REQ-609 (demo cycle 4, issue m48) — Tasks vs work orders, zone/subscription jargon.
 * A one-off trade (a fence builder) read /field/tasks and asked "what's a zone and a
 * subscription?". The Tasks title/sub/empty state and the Workers "Covers" hint now lead with
 * one-off tasks and call subscriptions "repeat visits"; and /work-orders says, in one line, how a
 * work order differs from a task (a finished task never becomes a work order).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const TASK_KEYS = ["field.tk.title", "field.tk.sub", "field.tk.none"];

describe("REQ-609 (demo c4 m48) Tasks copy leads with one-off tasks, no zone/subscription jargon", () => {
  test("Tasks title/sub/empty never say zone, subscription or round (en + es)", () => {
    for (const k of TASK_KEYS) {
      expect([k, en[k]]).not.toEqual([
        k,
        expect.stringMatching(/zone|subscription|round/i),
      ]);
      expect([k, es[k]]).not.toEqual([
        k,
        expect.stringMatching(/zona|suscripci|ronda/i),
      ]);
    }
  });

  test("Tasks sub and empty state name one-off jobs first, and call subscriptions repeat visits", () => {
    for (const k of ["field.tk.sub", "field.tk.none"]) {
      expect(en[k]).toMatch(/Add task/);
      expect(es[k]).toMatch(/Agregar tarea/);
    }
    expect(en["field.tk.sub"]).toMatch(/repeat visits/i);
    expect(es["field.tk.sub"]).toMatch(/visitas repetidas/i);
    expect(en["field.tk.none"]).toMatch(/repeat visits/i);
    expect(es["field.tk.none"]).toMatch(/visitas repetidas/i);
    // the one-off path comes before the repeat-visit path
    for (
      const [v, oneOff, repeat] of [
        [en["field.tk.none"], "Add task", "repeat visits"],
        [es["field.tk.none"], "Agregar tarea", "visitas repetidas"],
        [en["field.tk.sub"], "Add task", "repeat visits"],
        [es["field.tk.sub"], "Agregar tarea", "visitas repetidas"],
      ]
    ) {
      expect(v.indexOf(oneOff)).toBeLessThan(v.toLowerCase().indexOf(repeat));
    }
  });

  test("Workers 'Covers' hint explains zones as areas of repeat visits, not bare 'zone'", () => {
    expect(en["field.wk.coversNone"]).toMatch(/repeat visits/i);
    expect(es["field.wk.coversNone"]).toMatch(/visitas repetidas/i);
    expect(en["field.wk.coversNone"]).not.toMatch(/^no zone yet/);
    // still a value after "Covers": lowercase, no full stop; still points to Assignments
    for (const v of [en["field.wk.coversNone"], es["field.wk.coversNone"]]) {
      expect(v[0]).toBe(v[0].toLowerCase());
      expect(v.endsWith(".")).toBe(false);
    }
    expect(en["field.wk.coversNone"]).toMatch(/Assignments/);
    expect(es["field.wk.coversNone"]).toMatch(/Asignaciones/);
  });

  test("Work orders page carries a one-line explainer of how it differs from Tasks (en + es)", () => {
    expect(en["workOrders.vsTasks"]).toMatch(/Tasks/);
    expect(es["workOrders.vsTasks"]).toMatch(/Tareas/);
    expect(en["workOrders.vsTasks"]).toMatch(/quote|invoice/i);
    expect(es["workOrders.vsTasks"]).toMatch(/cotizaci|factura/i);
    const src = read("front-end/islands/WorkOrdersPage.tsx");
    expect(src).toMatch(/data-cy="wo-vs-tasks"/);
    expect(src).toMatch(/t\("workOrders\.vsTasks"\)/);
    expect(src).toMatch(/href="\/field\/tasks"/);
  });
});

/**
 * REQ-743 (demo cycle 5, issues p18-6c + p18-8b) — the rest of the product said "Subscriptions"
 * for what Tasks (REQ-609) calls "repeat visits": the Field nav entry, the /field/subscriptions
 * page and the customer card's panel ("Suscripciones" on a handyman's card). That word is also
 * the owner's own DocuMonster plan. Every one of them now says "Repeat visits" / "Visitas
 * repetidas" (the route stays), and the card hides the panel for a customer with none unless the
 * business is a service trade.
 */
import {
  repeatVisitsPanelShown,
  tradeKindFor,
} from "../../shared/quote-flow/trade-fit";

const RENAMED_KEYS = [
  "nav.subscriptions",
  "field.subs.docTitle",
  "field.subs.eyebrow",
  "field.subs.title",
  "field.subs.sub",
  "field.subs.new",
  "field.subs.editTitle",
  "field.subs.empty",
  "field.subs.confirmDelete",
  "clientsBoard.panel.subs",
  "clientsBoard.panel.subsNone",
  "clientsBoard.panel.subsOpen",
  "clientsBoard.subsCount.one",
  "clientsBoard.subsCount.other",
];

describe("REQ-743 (demo c5 p18-6c, p18-8b) one name for repeat visits: nav, page and customer card", () => {
  test("the nav entry, page and card keys never say subscription (en) / suscripción (es)", () => {
    for (const k of RENAMED_KEYS) {
      expect([k, en[k]]).toEqual([k, expect.any(String)]);
      expect([k, es[k]]).toEqual([k, expect.any(String)]);
      expect([k, en[k]]).not.toEqual([k, expect.stringMatching(/subscri/i)]);
      expect([k, es[k]]).not.toEqual([k, expect.stringMatching(/suscrip/i)]);
    }
  });

  test("no field.subs.* or clientsBoard.* copy says subscription, in either language", () => {
    const hits = [
      ...Object.entries(en).filter(([k, v]) =>
        /^(field\.subs|clientsBoard)\./.test(k) && /subscri/i.test(v)
      ),
      ...Object.entries(es).filter(([k, v]) =>
        /^(field\.subs|clientsBoard)\./.test(k) && /suscrip/i.test(v)
      ),
    ].map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });

  test("the nav entry and the card panel are named exactly as Tasks names them", () => {
    expect(en["nav.subscriptions"]).toBe("Repeat visits");
    expect(es["nav.subscriptions"]).toBe("Visitas repetidas");
    expect(en["clientsBoard.panel.subs"]).toBe("Repeat visits");
    expect(es["clientsBoard.panel.subs"]).toBe("Visitas repetidas");
    expect(en["field.subs.eyebrow"]).toMatch(/^Repeat visits · \{n\}/);
    expect(es["field.subs.eyebrow"]).toMatch(/^Visitas repetidas · \{n\}/);
    expect(en["clientsBoard.subsCount.other"]).toBe("{n} repeat visits");
    expect(es["clientsBoard.subsCount.other"]).toBe("{n} visitas repetidas");
  });

  test("the card's panel shows only when the customer has repeat visits or the trade is a service trade", () => {
    expect(tradeKindFor("Joe's Handyman")).toBe("project");
    expect(tradeKindFor("Sparkle Cleaning")).toBe("service");
    expect(repeatVisitsPanelShown(0, "project")).toBe(false);
    expect(repeatVisitsPanelShown(1, "project")).toBe(true);
    expect(repeatVisitsPanelShown(0, "service")).toBe(true);
    expect(repeatVisitsPanelShown(2, "service")).toBe(true);
  });

  test("ClientsBoard gates the panel on that rule, and the route hands the trade down from the business name", () => {
    const board = read("front-end/islands/ClientsBoard.tsx");
    expect(board).toMatch(/repeatVisitsPanelShown\(subs\.length, tradeKind\)/);
    const page = read("front-end/islands/ClientsPage.tsx");
    expect(page).toMatch(/tradeKind=\{tradeKind\}/);
    const route = read("front-end/routes/clients/index.tsx");
    expect(route).toMatch(/tradeKindFor\(/);
    expect(route).toMatch(/<ClientsPage tradeKind=\{tradeKind\}/);
  });
});
