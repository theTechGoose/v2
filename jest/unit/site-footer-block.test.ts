/**
 * REQ-078 — Raphael, 2026-10-15, on the login card's teal strip after the
 * four links came back (REQ-076): "can you make this better" — the links
 * wrapped into the phone's row ("Privacy Policy  SMS Terms & Conditions
 * 855-362-8666"), a jumble. So the SiteFooter every app page ends with is
 * two blocks: a two-column grid of the four policy links (two by two), then
 * the phone and the address on their own line beneath. One component, so it
 * is the same block in the login/contact/verify card, the dashboard, the
 * public documents, the assistant, the error page and the legal pages.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-078 the card's footer strip is a tidy block", () => {
  it("REQ-078 the SiteFooter is two blocks: a two-column grid of the four links, then the phone and the address — on every page it ends", () => {
    const src = read("front-end/components/SiteFooter.tsx");
    // the links block: a nav, a two-column grid, the four links from the one list inside it
    const nav = src.match(/<nav[^>]*data-site-footer-links[\s\S]*?<\/nav>/);
    expect(nav).not.toBeNull();
    expect(nav![0]).toMatch(/display:grid;grid-template-columns:repeat\(2,/);
    expect(nav![0]).toMatch(/LEGAL_LINKS\.map/);
    expect(nav![0]).toMatch(/aria-label=\{tFor\(lang, "siteFooter\.policiesAria"\)\}/);
    // the contact block after it: the phone, then the address
    const after = src.slice(src.indexOf("</nav>"));
    const contact = after.match(/<div[^>]*data-site-footer-contact[\s\S]*?<\/div>/);
    expect(contact).not.toBeNull();
    expect(contact![0].indexOf("data-site-phone")).toBeGreaterThan(-1);
    expect(contact![0].indexOf("data-site-address")).toBeGreaterThan(contact![0].indexOf("data-site-phone"));
    // the links never sit in the footer's own row with the phone
    expect(src.indexOf("data-site-footer-links")).toBeLessThan(src.indexOf("data-site-footer-contact"));
    // the grid's label in both dictionaries
    expect(en["siteFooter.policiesAria"]).toBe("Policies");
    expect(es["siteFooter.policiesAria"]).toBe("Políticas");
    // one component, every page: no route renders its own copy of the links
    const routes = path.join(ROOT, "front-end/routes");
    const rogue: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx$/.test(e.name) && fs.readFileSync(p, "utf8").includes("data-site-footer")) rogue.push(path.relative(ROOT, p));
      }
    };
    walk(routes);
    expect(rogue).toEqual([]);
  });
});
