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
    expect(nav![0]).toMatch(
      /aria-label=\{tFor\(lang, "siteFooter\.policiesAria"\)\}/,
    );
    // the contact block after it: the phone, then the address
    const after = src.slice(src.indexOf("</nav>"));
    const contact = after.match(
      /<div[^>]*data-site-footer-contact[\s\S]*?<\/div>/,
    );
    expect(contact).not.toBeNull();
    expect(contact![0].indexOf("data-site-phone")).toBeGreaterThan(-1);
    expect(contact![0].indexOf("data-site-address")).toBeGreaterThan(
      contact![0].indexOf("data-site-phone"),
    );
    // the links never sit in the footer's own row with the phone
    expect(src.indexOf("data-site-footer-links")).toBeLessThan(
      src.indexOf("data-site-footer-contact"),
    );
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
        else if (
          /\.tsx$/.test(e.name) &&
          fs.readFileSync(p, "utf8").includes("data-site-footer")
        ) rogue.push(path.relative(ROOT, p));
      }
    };
    walk(routes);
    expect(rogue).toEqual([]);
  });
});

/**
 * REQ-079 — Raphael, 2026-10-15, on REQ-078's strip inside the login card: "just make this the
 * actual footer." The SiteFooter is the page's own footer: it paints itself (teal, the full
 * width, square corners — not verify.css's accidental `footer` rule, gone with `.footer-grid`),
 * no page dresses it with a style, the card pages render it AFTER the card as the shell's last
 * child, and the panes that pad their content bleed it to their edges.
 */
describe("REQ-079 the block is the page's actual footer", () => {
  it("REQ-079 the SiteFooter paints itself teal and full width, no page styles it, the card pages end with it outside the card, and the padded panes bleed it to their edges", () => {
    const src = read("front-end/components/SiteFooter.tsx");
    const tag = src.match(/<footer[\s\S]*?>/)![0];
    expect(tag).toMatch(/background:var\(--brand-teal/);
    expect(tag).not.toMatch(/border-radius/);
    expect(src).not.toMatch(/style\?: string/);
    // verify.css no longer paints every <footer> as a website footer
    const verify = read("front-end/static/verify.css");
    expect(verify).not.toMatch(/^footer \{/m);
    expect(verify).not.toMatch(/\.footer-grid/);
    // the card pages: card closes, the footer, the shell closes, the fragment closes
    for (
      const route of [
        "login",
        "login-internal",
        "verify",
        "verify-internal",
        "contact",
        "pay/fake",
        "plan/test",
      ]
    ) {
      expect(read(`front-end/routes/${route}.tsx`)).toMatch(
        /<\/div>\s*<SiteFooter lang=\{lang\} \/>\s*<\/div>\s*<\/>/,
      );
    }
    // no page dresses the footer
    const routes = path.join(ROOT, "front-end/routes");
    const dressed: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (
          /\.tsx$/.test(e.name) &&
          /<SiteFooter[^>]*style=/.test(fs.readFileSync(p, "utf8"))
        ) dressed.push(path.relative(ROOT, p));
      }
    };
    walk(routes);
    expect(dressed).toEqual([]);
    expect(read("front-end/components/LegalPage.tsx")).not.toMatch(
      /<SiteFooter[^>]*style=/,
    );
    // the padded panes bleed it to their edges
    expect(read("front-end/static/dashboard.css")).toMatch(
      /\.content > \.site-footer \{/,
    );
    expect(read("front-end/static/welcome.css")).toMatch(
      /\.welcome-shell > \.site-footer \{/,
    );
  });
});
