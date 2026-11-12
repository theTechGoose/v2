/**
 * REQ-509 — demo-loop cycle 3, issue m24 ("fix every issue the demo found, loop
 * until there are none"): "Footer eats phone space and shows DocuMonster's
 * contact details on the contractor's documents".
 *  - The public customer documents (/q, /i, /co) end with the `document`
 *    footer: the four policy links and "Powered by DocuMonster" — never
 *    DocuMonster's support phone or its Myrtle Beach address under the
 *    contractor's own quote or invoice.
 *  - The compact app footer drops the phone and the address on a phone
 *    (≤640px), so it is the links alone.
 *  - The dashboard shell on a phone is a min-height flex column, so a short
 *    page's footer sits at the bottom of the screen, not mid-screen.
 */
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { renderToString } from "preact-render-to-string";
import SiteFooter from "../components/SiteFooter.tsx";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";
import {
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_DISPLAY,
} from "../../shared/legal/contact.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-509 m24: the document footer (${lang}) carries the four policy links and "Powered by DocuMonster", no DocuMonster phone or address`, () => {
    const html = renderToString(<SiteFooter lang={lang} document />);
    assertMatch(html, /data-site-footer-document/);
    for (const l of LEGAL_LINKS) {
      assert(html.includes(`href="${l.path}"`), `link ${l.path}`);
    }
    assert(!html.includes("tel:"), "no tel: link");
    assert(!html.includes(SUPPORT_PHONE_DISPLAY), "no support phone");
    assert(!html.includes(BUSINESS_ADDRESS), "no business address");
    assert(!html.includes("data-site-phone"));
    assert(!html.includes("data-site-address"));
    assertMatch(html, /data-site-powered-by/);
    assertMatch(
      html,
      lang === "en"
        ? /Powered by DocuMonster/
        : /Con la tecnología de DocuMonster/,
    );
  });
}

Deno.test("REQ-509 m24: the full and compact footers still carry the phone and the address (REQ-044)", () => {
  for (
    const html of [
      renderToString(<SiteFooter lang="en" />),
      renderToString(<SiteFooter lang="en" compact />),
    ]
  ) {
    assert(html.includes(SUPPORT_PHONE_DISPLAY));
    assert(html.includes(BUSINESS_ADDRESS));
    assert(!html.includes("data-site-footer-document"));
  }
});

Deno.test("REQ-509 m24: on a phone the compact footer hides the phone and the address — the links alone", () => {
  const html = renderToString(<SiteFooter lang="en" compact />);
  const style = html.match(/<style>([\s\S]*?)<\/style>/);
  assert(style, "the compact footer carries its phone rule");
  assertMatch(
    style![1],
    /@media \(max-width: ?640px\)\s*\{[^}]*\.site-footer--compact \[data-site-phone\][^{]*\.site-footer--compact \[data-site-address\][^{]*\{\s*display: ?none ?!important/,
  );
});

Deno.test("REQ-509 m24: /q, /i and /co render the document footer", () => {
  for (
    const r of ["routes/q/[id].tsx", "routes/i/[id].tsx", "routes/co/[id].tsx"]
  ) {
    const src = read(r);
    assertMatch(src, /<SiteFooter lang=\{lang\} document( credited)? \/>/, r);
    assertEquals(/<SiteFooter lang=\{lang\} \/>/.test(src), false, r);
  }
});

Deno.test("REQ-509 m24: on a phone the dashboard shell is a min-height flex column and the content fills it, so the footer (margin-top:auto) sits at the bottom", () => {
  const css = read("static/dashboard.css");
  const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
  const block = (sel: string) => {
    const m = phone.match(
      new RegExp(`\\n  ${sel.replace(".", "\\.")} \\{([^}]*)\\}`),
    );
    assert(m, sel);
    return m![1];
  };
  const app = block(".app");
  assertMatch(app, /min-height: calc\(100dvh/);
  assertMatch(app, /display: flex;/);
  assertMatch(app, /flex-direction: column;/);
  const main = block(".main");
  assertMatch(main, /display: flex;/);
  assertMatch(main, /flex-direction: column;/);
  assertMatch(main, /flex: 1 0 auto;/);
  assertMatch(block(".content"), /flex: 1 0 auto;/);
  // the footer's auto top margin (REQ-079) is what pushes it down
  assertMatch(css, /\.content > \.site-footer \{\s*margin: auto /);
});

/**
 * REQ-573 — demo-loop cycle 4, issue p4-p3c ("fix every issue the demo found,
 * loop until there are none"): "'Powered by DocuMonster' shown twice". The
 * signed quote already ends with "Powered by DocuMonster · Agreement Q-001"
 * (components/quote-doc.tsx) and the invoice with "Powered by DocuMonster ·
 * Invoice …" (routes/i/[id].tsx); REQ-509's document footer printed the
 * credit a second time right under it. A document whose body credits
 * DocuMonster passes `credited`, and its footer drops the line.
 */
const countPowered = (html: string) =>
  (html.match(/Powered by DocuMonster|Con la tecnología de DocuMonster/g) ??
    []).length;

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-573 p4-p3c: a credited document footer (${lang}) keeps the four policy links and drops "Powered by DocuMonster"`, () => {
    const html = renderToString(<SiteFooter lang={lang} document credited />);
    assertMatch(html, /data-site-footer-document/);
    for (const l of LEGAL_LINKS) {
      assert(html.includes(`href="${l.path}"`), `link ${l.path}`);
    }
    assert(!html.includes("data-site-powered-by"), "no powered-by span");
    assertEquals(countPowered(html), 0);
  });
}

Deno.test("REQ-573 p4-p3c: an uncredited document footer still credits DocuMonster once", () => {
  assertEquals(
    countPowered(renderToString(<SiteFooter lang="en" document />)),
    1,
  );
});

Deno.test("REQ-573 p4-p3c: /q and /i (their body credits DocuMonster) pass `credited`; /co (it does not) keeps the footer's credit", () => {
  assertMatch(
    read("components/quote-doc.tsx"),
    /\{t\.poweredBy\} \{docNumber\}/,
  );
  assertMatch(read("routes/i/[id].tsx"), /public\.doc\.poweredByInvoice/);
  for (const r of ["routes/q/[id].tsx", "routes/i/[id].tsx"]) {
    assertMatch(read(r), /<SiteFooter lang=\{lang\} document credited \/>/, r);
  }
  const co = read("routes/co/[id].tsx");
  assertEquals(
    /poweredBy|Powered by/.test(co),
    false,
    "/co body has no credit",
  );
  assertMatch(co, /<SiteFooter lang=\{lang\} document \/>/);
});
