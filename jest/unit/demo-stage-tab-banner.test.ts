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
    pageLabel(
      path: string,
      tr: (key: string) => string,
      title?: string | null,
    ): string;
    titleName(title?: string | null): string;
  };
const trOf = (dict: Record<string, string>) => (k: string) => dict[k] ?? k;

describe("REQ-826 (demo-loop cycle dm2, p10) pageLabel: the banner names the page, never its URL", () => {
  test("app pages map to a page name in en — IDs and the query string dropped", () => {
    const L = (p: string) => pl().pageLabel(p, trOf(en));
    // REQ-826 AMENDMENT 4 (dm10, p3) — the public page is the quote + agreement
    expect(L("/q/cfe16416-ed6e-48ee-9b98-a636c835d3e3?lang=en")).toBe(
      "Quote + Agreement",
    );
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
    expect(L("/co/abc")).toBe("Change order"); // REQ-826 AMENDMENT 4 (dm10, m3)
    expect(L("/admin")).toBe("Admin");
    expect(L("/contact")).toBe("Contact");
  });
  test("the same pages in es", () => {
    const L = (p: string) => pl().pageLabel(p, trOf(es));
    expect(L("/q/cfe16416-ed6e-48ee-9b98-a636c835d3e3?lang=en")).toBe(
      "Cotización + Acuerdo",
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
      // REQ-826 AMENDMENT 3 (dm9, p1) — the mirrored document's title names an unknown page
      /t\("demoMode\.tabSwitched", \{\s*name,(?:\s*\/\/[^\n]*)*\s*page: pageLabel\(\s*tabNote,\s*t,\s*mirroredTitle\(\),(?:\s*\/\/[^\n]*)*\s*mirroredErrorPage\(\),?\s*\),?\s*\}\)/,
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

describe("REQ-826 AMENDMENT 3 (demo-loop run 9, p1) — a page with no name of its own is named by its document title, never its path", () => {
  const L = (p: string, title?: string | null) =>
    pl().pageLabel(p, trOf(en), title);
  test("a 404 page typed by hand: its title's own part, not '(Outbox)' / '(Campo)' read off the path", () => {
    expect(L("/outbox", "No encontramos esa página · DocuMonster")).toBe(
      "No encontramos esa página",
    );
    expect(L("/campo/xyz", "Page not found · DocuMonster")).toBe(
      "Page not found",
    );
    expect(L("/field-notes/7f3a", "Field notes | DocuMonster")).toBe(
      "Field notes",
    );
  });
  test("a known page keeps its localized name whatever the title says", () => {
    expect(L("/dashboard", "Something else · DocuMonster")).toBe("Dashboard");
    expect(L("/q/cfe16416-ed6e-48ee-9b98-a636c835d3e3", "Quote · X")).toBe(
      "Quote + Agreement",
    );
  });
  test("no title, an empty one, or the bare app name: the path's first segment as before", () => {
    expect(L("/field-notes/x")).toBe("Field notes");
    expect(L("/field-notes/x", "")).toBe("Field notes");
    expect(L("/field-notes/x", "   ")).toBe("Field notes");
    expect(L("/field-notes/x", "DocuMonster")).toBe("Field notes");
    expect(L("/field-notes/x", "documonster")).toBe("Field notes");
  });
  test("titleName: the part before the app's separator, whitespace squashed, long names cut at 40", () => {
    const T = (t?: string | null) => pl().titleName(t);
    expect(T("Mi página  de\n prueba · DocuMonster")).toBe(
      "Mi página de prueba",
    );
    expect(T("Settings - DocuMonster")).toBe("Settings");
    expect(T("Settings — DocuMonster")).toBe("Settings");
    expect(T("Just a title")).toBe("Just a title");
    expect(T(null)).toBe("");
    expect(T(undefined)).toBe("");
    expect(T("x".repeat(60))).toBe("x".repeat(39) + "…");
    // a hyphenated name is not split: the separator is a spaced dash
    expect(T("Field-notes · DocuMonster")).toBe("Field-notes");
  });
});

describe("REQ-826 AMENDMENT 4 (demo-loop run 10: m2, m3, p3) — an error page under a known path is named by its title; a change order and the public quote + agreement by their own names", () => {
  const L = (p: string, title?: string | null, errorPage = false) =>
    pl().pageLabel(p, trOf(es), title, errorPage);
  test("m2: a 404 at /quotes/new — the mirrored page IS the error page: its title's name, not '(Cotización)' off the known prefix", () => {
    expect(L("/quotes/new", "No encontramos esa página · DocuMonster", true))
      .toBe("No encontramos esa página");
    // the same path, a real page: the known name as before
    expect(L("/quotes/new", "Nueva cotización · DocuMonster", false)).toBe(
      "Cotización",
    );
    // an error page with no title of its own: the known name (nothing better to say)
    expect(L("/quotes/new", "", true)).toBe("Cotización");
  });
  test("m3: /co/<id> is a change order ('Orden de cambio' / 'Change order'), not '(Contrato)'", () => {
    expect(L("/co/7f3a9c2e-1b4d-4e5f-8a9b-0c1d2e3f4a5b")).toBe(
      "Orden de cambio",
    );
    expect(pl().pageLabel("/co/7f3a9c2e-1b4d-4e5f-8a9b-0c1d2e3f4a5b", trOf(en)))
      .toBe("Change order");
    expect(pl().pageLabelKey("/co/x")).toBe("demoMode.page.changeOrder");
    expect(en["demoMode.page.changeOrder"]).toBe("Change order");
    expect(es["demoMode.page.changeOrder"]).toBe("Orden de cambio");
  });
  test("p3: the public /q/<id> page is the quote + agreement the customer reads ('Cotización + Acuerdo'); the app's own /quotes/<id> stays 'Cotización'", () => {
    expect(L("/q/7f3a9c2e-1b4d-4e5f-8a9b-0c1d2e3f4a5b?lang=es")).toBe(
      "Cotización + Acuerdo",
    );
    expect(pl().pageLabel("/q/7f3a9c2e", trOf(en))).toBe("Quote + Agreement");
    expect(L("/quotes/7f3a9c2e-1b4d-4e5f-8a9b-0c1d2e3f4a5b")).toBe(
      "Cotización",
    );
    expect(en["demoMode.page.publicQuote"]).toBe("Quote + Agreement");
    expect(es["demoMode.page.publicQuote"]).toBe("Cotización + Acuerdo");
  });
  test("wiring: the error page marks itself (data-error-page) and the stage reads the mark off the mirrored document", () => {
    const err = read("front-end/routes/_error.tsx");
    expect(err).toMatch(/data-error-page=""/);
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(
      /const mirroredErrorPage = \(\)[^;]*contentDocument\?\.querySelector\(\s*"\[data-error-page\]",?\s*\)/s,
    );
  });
});

describe("REQ-826 AMENDMENT 5 (demo-loop run 11: demo 5 #2, demo 4 #1) — the stage names a mirrored page by its title in the STAGE's language (the DocTitle's data-title-es/en), and a dead public invoice or change-order link is an error page named by its heading", () => {
  test("wiring: DemoStage reads the mirrored title through liveTitle(doc, langSignal.value), falling back to document.title, and passes it to pageLabel", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(
      /import \{[^}]*\bliveTitle\b[^}]*\} from "\.\.\/lib\/doc-title\.ts"/s,
    );
    expect(stage).toMatch(
      /const mirroredTitle = \(\) => \{[\s\S]{0,200}?liveTitle\(\s*d,\s*langSignal\.value,?\s*\)\s*\?\?\s*d\.title/,
    );
    expect(stage).toMatch(
      /t\("demoMode\.tabSwitched", \{\s*name,(?:\s*\/\/[^\n]*)*\s*page: pageLabel\(\s*tabNote,\s*t,\s*mirroredTitle\(\),(?:\s*\/\/[^\n]*)*\s*mirroredErrorPage\(\),?\s*\),?\s*\}\)/,
    );
  });
  test("a dead /i/<id> or /co/<id> link: the DocTitle is the error heading and the page carries data-error-page, so the notice says '(Mmm, no se puede abrir esto)', not '(Factura)'", () => {
    const inv = read("front-end/routes/i/[id].tsx");
    expect(inv).toMatch(
      /err\s*\?\s*tFor\(l,\s*"publicInvoice\.error\.heading"\)/,
    );
    expect(inv).toMatch(/data-error-page=\{err \? "" : undefined\}/);
    const co = read("front-end/routes/co/[id].tsx");
    expect(co).toMatch(
      /!co\s*\?\s*tFor\(l,\s*"changeOrderPublic\.error\.title"\)/,
    );
    expect(co).toMatch(/data-error-page=\{co \? undefined : ""\}/);
    // and pageLabel names it off that title
    expect(
      pl().pageLabel(
        "/i/nonexistent123",
        trOf(es),
        "Mmm, no se puede abrir esto · Ruiz Remodelación",
        true,
      ),
    ).toBe("Mmm, no se puede abrir esto");
    expect(
      pl().pageLabel(
        "/i/nonexistent123",
        trOf(es),
        "Factura · Ruiz Remodelación",
        false,
      ),
    ).toBe("Factura");
  });
});
