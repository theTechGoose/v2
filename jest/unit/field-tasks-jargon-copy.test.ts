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

/**
 * REQ-997 (LOOP-007 cycle 1, q1-84) — /field/assignments read "Assignments · 1 zones",
 * "1 zones with no worker" and "1 ZONES · 1 SUBSCRIPTIONS". Its count strings were single
 * strings with the plural noun baked in, rendered with t() instead of the tn() .one/.other
 * helper; and REQ-743 left the field.asg.* keys saying "subscription(s)" (amended here: they
 * now say "repeat visit(s)" / "visita(s) repetida(s)" like the rest of the app).
 */
const ASG_COUNT_KEYS = [
  "field.asg.eyebrow",
  "field.asg.crewLoad",
  "field.asg.unstaffedCrews",
  "field.asg.unstaffedCount",
  "field.asg.regrouped",
];

describe("REQ-997 (LOOP-007 q1-84) Assignments counts are pluralised and say repeat visits", () => {
  test("REQ-997: no field.asg.* copy says subscription (en) / suscripción (es)", () => {
    const hits = [
      ...Object.entries(en).filter(([k, v]) =>
        k.startsWith("field.asg.") && /subscri/i.test(v)
      ),
      ...Object.entries(es).filter(([k, v]) =>
        k.startsWith("field.asg.") && /suscrip/i.test(v)
      ),
    ].map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });

  test("REQ-997: every Assignments count key has .one and .other, and no bare plural string stays", () => {
    for (const dict of [en, es]) {
      for (const k of ASG_COUNT_KEYS) {
        expect([k, dict[`${k}.one`]]).toEqual([k, expect.any(String)]);
        expect([k, dict[`${k}.other`]]).toEqual([k, expect.any(String)]);
        expect([k, dict[k]]).toEqual([k, undefined]);
      }
    }
  });

  test("REQ-997: the .one form is singular — 1 zone, never 1 zones / 1 zonas", () => {
    for (const k of ASG_COUNT_KEYS) {
      const one = en[`${k}.one`] ?? "";
      const uno = es[`${k}.one`] ?? "";
      expect([k, one]).toEqual([k, expect.stringMatching(/\bzone\b/)]);
      expect([k, one]).not.toEqual([k, expect.stringMatching(/\bzones\b/)]);
      expect([k, uno]).toEqual([k, expect.stringMatching(/\bzona\b/)]);
      expect([k, uno]).not.toEqual([k, expect.stringMatching(/\bzonas\b/)]);
    }
  });

  test("REQ-997: the worker load chip renders '1 zone · 1 repeat visit' / '2 zones · 3 repeat visits'", () => {
    // whatever key split the fix picks, the page's worker chip text is built from en.json
    // through tn(); render it the way the island does and read the result
    const src = read("front-end/islands/FieldAssignmentsPage.tsx");
    for (const k of ASG_COUNT_KEYS) {
      expect([k, src]).not.toEqual([
        k,
        expect.stringContaining(`t("${k}"`),
      ]);
    }
    expect(src).not.toMatch(/\bt\("field\.asg\.load"/);
    const fill = (s: string, vars: Record<string, number>) =>
      s.replace(/\{(\w+)\}/g, (_, v) => String(vars[v]));
    const pick = (dict: Record<string, string>, key: string, n: number) =>
      fill(dict[`${key}.${n === 1 ? "one" : "other"}`] ?? `<${key}>`, { n });
    const loadKeys = Object.keys(en).filter((k) =>
      /^field\.asg\.load[A-Za-z]*\.(one|other)$/.test(k)
    );
    const bases = [...new Set(loadKeys.map((k) => k.replace(/\.(one|other)$/, "")))];
    expect(bases.length).toBeGreaterThanOrEqual(1);
    const zonesKey = bases.find((b) => /zone/i.test(en[`${b}.other`] ?? ""));
    const visitsKey = bases.find((b) => /repeat visit/i.test(en[`${b}.other`] ?? ""));
    expect([zonesKey, visitsKey]).toEqual([expect.any(String), expect.any(String)]);
    expect(`${pick(en, zonesKey!, 1)} · ${pick(en, visitsKey!, 1)}`).toBe(
      "1 zone · 1 repeat visit",
    );
    expect(`${pick(en, zonesKey!, 2)} · ${pick(en, visitsKey!, 3)}`).toBe(
      "2 zones · 3 repeat visits",
    );
    expect(`${pick(es, zonesKey!, 1)} · ${pick(es, visitsKey!, 1)}`).toBe(
      "1 zona · 1 visita repetida",
    );
    expect(src).toMatch(/tn\("field\.asg\.load/);
  });
});

/**
 * REQ-1059 — AMENDMENT of REQ-743 (LOOP-007 cycle 2, q2-48): /field/tasks → Add task read "One
 * customer, one day or several days in a row — not part of any subscription." REQ-743 listed
 * `field.tk.skippedGen/addHint` as out of scope and REQ-997 fixed only field.asg.*, so no guard
 * scanned field.tk.*. Every field.tk.* key now says "repeat visit(s)" / "visita(s) repetida(s)",
 * and the skipped-generation count is pluralised with tn() like REQ-997's Assignments counts.
 */
describe("REQ-1059 (LOOP-007 q2-48) Tasks page copy never says subscription", () => {
  test("REQ-1059: no field.tk.* copy says subscription (en) / suscripción (es)", () => {
    const hits = [
      ...Object.entries(en).filter(([k, v]) =>
        k.startsWith("field.tk.") && /subscri/i.test(v)
      ),
      ...Object.entries(es).filter(([k, v]) =>
        k.startsWith("field.tk.") && /suscrip/i.test(v)
      ),
    ].map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });

  test("REQ-1059: the Add task hint says a one-off task is not part of a repeat visit, and keeps the several-days sentence (REQ-785)", () => {
    expect(en["field.tk.addHint"]).toMatch(/repeat visit/i);
    expect(es["field.tk.addHint"]).toMatch(/visita repetida|visitas repetidas/i);
    expect(en["field.tk.addHint"]).toMatch(/several days/i);
    expect(es["field.tk.addHint"]).toMatch(/varios días/i);
  });

  test("REQ-1059: the skipped-generation count is .one/.other, says repeat visit(s), and the page renders it with tn()", () => {
    const fill = (s: string, n: number) => s.replace(/\{n\}/g, String(n));
    const k = "field.tk.skippedGen";
    expect([k, en[k]]).toEqual([k, undefined]);
    expect([k, es[k]]).toEqual([k, undefined]);
    expect(fill(en[`${k}.one`] ?? `<${k}.one>`, 1)).toBe("1 repeat visit with no worker");
    expect(fill(en[`${k}.other`] ?? `<${k}.other>`, 3)).toBe("3 repeat visits with no worker");
    expect(fill(es[`${k}.one`] ?? `<${k}.one>`, 1)).toMatch(/^1 visita repetida\b/);
    expect(fill(es[`${k}.other`] ?? `<${k}.other>`, 3)).toMatch(/^3 visitas repetidas\b/);
    const src = read("front-end/islands/FieldTasksPage.tsx");
    expect(src).not.toMatch(/\bt\("field\.tk\.skippedGen"/);
    expect(src).toMatch(/\btn\("field\.tk\.skippedGen"/);
  });
});

/**
 * REQ-1148 — AMENDMENT of REQ-743 (LOOP-007 cycle 3, q3-79): one thing, three names. The sidebar
 * and /field/subscriptions say "Repeat visits / Visitas repetidas"; Settings → Edit your details
 * still said "every subscription / cada suscripción" (`settings.netDaysHint`, REQ-743 left it out
 * of scope), and the REQ-924 customer page said "Recurring / recurring service / servicio
 * recurrente" — its "Start recurring service" opens the "New repeat visit" form. The guard above
 * only checked named keys and only banned "subscription", so it now scans the whole vocabulary:
 * every settings.*, customerWs.*, field.*, clientsBoard.* and nav.* value in both dictionaries.
 */
const VOCAB_NS = /^(settings|customerWs|field|clientsBoard|nav)\./;
// intentional plan-billing copy (the owner's own DocuMonster plan), if any, goes here
const PLAN_BILLING_ALLOW = new Set<string>([]);

describe("REQ-1148 (LOOP-007 q3-79) one name for repeat visits across Settings, the customer page, Field and nav", () => {
  test("REQ-1148: no settings/customerWs/field/clientsBoard/nav copy says subscription or recurring (en)", () => {
    const hits = Object.entries(en)
      .filter(([k, v]) =>
        VOCAB_NS.test(k) && !PLAN_BILLING_ALLOW.has(k) &&
        /subscri|\brecurring\b|recurring service/i.test(v)
      )
      .map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });

  test("REQ-1148: no settings/customerWs/field/clientsBoard/nav copy says suscripción or recurrente (es)", () => {
    const hits = Object.entries(es)
      .filter(([k, v]) =>
        VOCAB_NS.test(k) && !PLAN_BILLING_ALLOW.has(k) &&
        /suscrip|recurrente|servicio recurrente/i.test(v)
      )
      .map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });

  test("REQ-1148: the Settings net-days hint calls them repeat visits", () => {
    expect(en["settings.netDaysHint"]).toMatch(/repeat visit/i);
    expect(es["settings.netDaysHint"]).toMatch(/visita repetida|visitas repetidas/i);
  });

  test("REQ-1148: the customer page's tab is named exactly as the sidebar names the page", () => {
    expect(en["customerWs.tab.recurring"]).toBe(en["nav.subscriptions"]);
    expect(es["customerWs.tab.recurring"]).toBe(es["nav.subscriptions"]);
    for (const k of ["customerWs.act.startService", "customerWs.act.newService", "customerWs.ov.services", "customerWs.kpi.recurring"]) {
      expect([k, en[k]]).toEqual([k, expect.stringMatching(/repeat visit/i)]);
      expect([k, es[k]]).toEqual([k, expect.stringMatching(/visitas? repetidas?/i)]);
    }
  });

  test("REQ-1148: no copy anywhere points to a 'Field → Subscriptions' menu that is now called Repeat visits", () => {
    const hits = [
      ...Object.entries(en).filter(([, v]) => /→\s*Subscriptions/i.test(v)),
      ...Object.entries(es).filter(([, v]) => /→\s*Suscripciones/i.test(v)),
    ].map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });
});
