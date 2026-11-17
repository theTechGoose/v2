/**
 * REQ-826 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm2, issue p10: the stage's "Now showing {name}'s other tab" banner (REQ-645)
 *   1. printed the mirrored page's raw path — `/q/cfe16416-…?lang=en` — UUID, query and all;
 *   2. sat centred on the frame's top edge (translate -50% up), so its lower half covered the
 *      mirrored app's header — the pattern REQ-642 had already moved the off/absent badges out of.
 * Now: the banner names the page (`pageLabel`: /q/:id → Quote, /dashboard → Dashboard, …, no IDs,
 * no query) and sits in REQ-642's chrome row above the frame (stageBadgeTop, STAGE_BADGE_H,
 * translateX only).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

// looked up at run time: a missing module fails its own test, not the whole file
const pl = () =>
  require("../../shared/demo-mode/page-label") as {
    pageLabelKey(path: string): string | null;
    pageLabel(path: string, tr: (key: string) => string): string;
  };
const trOf = (dict: Record<string, string>) => (k: string) => dict[k] ?? k;

describe("REQ-826 (demo-loop cycle dm2, p10) pageLabel: the banner names the page, never its URL", () => {
  test("app pages map to a page name in en — IDs and the query string dropped", () => {
    const L = (p: string) => pl().pageLabel(p, trOf(en));
    expect(L("/q/cfe16416-ed6e-48ee-9b98-a636c835d3e3?lang=en")).toBe("Quote");
    expect(L("/i/9f1c2d3e-0000-4000-8000-000000000001")).toBe("Invoice");
    expect(L("/dashboard")).toBe("Dashboard");
    expect(L("/dashboard?tab=jobs#top")).toBe("Dashboard");
    expect(L("/settings")).toBe("Settings");
    expect(L("/settings/")).toBe("Settings");
    expect(L("/quotes")).toBe("Quotes");
    expect(L("/quotes/abc123")).toBe("Quote");
    expect(L("/invoices")).toBe("Invoices");
    expect(L("/customers/42")).toBe("Customer");
    expect(L("/assistant")).toBe("Assistant");
    expect(L("/")).toBe("Home");
    expect(L("")).toBe("Home");
    // REQ-826 AMENDMENT 2 (dm8, m5) — the pages the fallback printed raw: "(Field)", "(Terms)"
    expect(L("/field/workers")).toBe("Field");
    expect(L("/worker")).toBe("Worker view");
    expect(L("/terms")).toBe("Terms of service");
    expect(L("/privacy")).toBe("Privacy policy");
    expect(L("/refund-policy")).toBe("Refund policy");
    expect(L("/sms-terms")).toBe("SMS terms");
    expect(L("/contracts")).toBe("Contracts");
    expect(L("/co/abc")).toBe("Contract");
    expect(L("/admin")).toBe("Admin");
    expect(L("/contact")).toBe("Contact");
  });
  test("the same pages in es", () => {
    const L = (p: string) => pl().pageLabel(p, trOf(es));
    expect(L("/q/cfe16416-ed6e-48ee-9b98-a636c835d3e3?lang=en")).toBe(
      "Cotización",
    );
    expect(L("/i/x1")).toBe("Factura");
    expect(L("/dashboard")).toBe("Panel");
    expect(L("/settings")).toBe("Configuración");
    // REQ-826 AMENDMENT 2 (dm8, m5)
    expect(L("/field/workers")).toBe("Campo");
    expect(L("/terms")).toBe("Términos de servicio");
    expect(L("/worker")).toBe("Vista de trabajador");
  });
  test("an unknown page falls back to its first path segment, readable — never an ID", () => {
    const L = (p: string) => pl().pageLabel(p, trOf(en));
    expect(L("/field-notes/7f3a9c1e-1111-4222-8333-444455556666?x=1")).toBe(
      "Field notes",
    );
    // a first segment that is itself an ID is never printed
    const odd = L("/cfe16416-ed6e-48ee-9b98-a636c835d3e3");
    expect(odd).not.toMatch(/cfe16416/);
    expect(odd).toBe(en["demoMode.page.other"]);
  });
  test("every key pageLabelKey can return exists in en and es", () => {
    const paths = [
      "/",
      "/dashboard",
      "/q/1",
      "/quotes",
      "/quotes/1",
      "/i/1",
      "/invoices",
      "/invoices/1",
      "/customers",
      "/customers/1",
      "/clients",
      "/payments",
      "/pay/1",
      "/settings",
      "/assistant",
      "/messages",
      "/work-orders",
      "/work-orders/1",
      "/wo/1",
      "/reports",
      "/plan",
      "/login",
      "/verify",
      "/welcome",
      "/0123456789abcdef",
      // REQ-826 AMENDMENT 2 (dm8, m5)
      "/field",
      "/field/workers",
      "/worker",
      "/terms",
      "/privacy",
      "/refund-policy",
      "/sms-terms",
      "/contracts",
      "/contracts/1",
      "/co/1",
      "/admin",
      "/admins",
      "/contact",
      "/accounts-manager",
      "/ops",
      "/s/abc",
      "/demo/stage",
    ];
    for (const p of paths) {
      const k = pl().pageLabelKey(p);
      expect(k).not.toBeNull();
      expect(en[k as string]).toEqual(expect.any(String));
      expect(es[k as string]).toEqual(expect.any(String));
    }
    expect(pl().pageLabelKey("/field-notes")).toBeNull();
  });
  test("the copy takes {page}, not {path}, in en and es", () => {
    expect(en["demoMode.tabSwitched"]).toBe(
      "Now showing {name}'s other tab ({page}) — move to point there",
    );
    expect(es["demoMode.tabSwitched"]).toBe(
      "Ahora ves la otra pestaña de {name} ({page}) — mueve el puntero para señalar ahí",
    );
  });
});

describe("REQ-826 (demo-loop cycle dm2, p10) DemoStage: the banner is wired to pageLabel and sits in the chrome row", () => {
  const src = read("front-end/islands/DemoStage.tsx");
  test("the banner text is the page's name (pageLabel over t), never the raw tabNote path", () => {
    expect(src).toMatch(/from "\.\.\/\.\.\/shared\/demo-mode\/page-label\.ts"/);
    expect(src).toMatch(
      /t\("demoMode\.tabSwitched", \{\s*name,\s*page: pageLabel\(tabNote, t\),?\s*\}\)/,
    );
    expect(src).not.toContain("path: tabNote");
  });
  test("REQ-642 extended: demo-tab-switched uses stageBadgeTop + STAGE_BADGE_H, translateX only — no -50% vertical translate", () => {
    const at = src.indexOf('data-cy="demo-tab-switched"');
    expect(at).toBeGreaterThan(-1);
    const style = src.slice(at, src.indexOf("</div>", at));
    expect(style).toContain("stageBadgeTop(fit.top - bannerH)");
    expect(style).toContain("transform:translateX(-50%)");
    expect(style).toContain("height:${STAGE_BADGE_H}px");
    expect(style).not.toContain("translate(-50%,-50%)");
  });
});
