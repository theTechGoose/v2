/**
 * REQ-367 — demo-loop cycle 1, issue m10: "Text left in the other language after an EN/ES
 * switch (footer, tab title, old cards, relative times)". The footer was a server component on
 * 30 routes and every route wrote its <title> once at SSR, so a switch left both in the old
 * language until a reload. These render the real pieces:
 *   - `onLangChange`: what the live footer and HtmlLang follow — every CHANGE of the app
 *     language, never the value it holds when they subscribe (on a page that never seeded it,
 *     that is the module-load default, not a choice);
 *   - `DocTitle` + `liveTitle` / `followTitle`: the page's <title> carries both languages and the
 *     shell sets document.title from it on a switch;
 *   - the footer: SSR language first (hydration matches), both languages' words carried to the
 *     island as props (no dictionary in the browser).
 *
 *   cd front-end && deno test -A lib/live-lang.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { type Lang, langSignal } from "./lang.ts";
import { tFor } from "./i18n.ts";
import { onLangChange } from "./live-lang.ts";
import { followTitle, liveTitle, titleAttr } from "./doc-title.ts";
import DocTitle from "../components/DocTitle.tsx";
import SiteFooter, { siteFooterCopy } from "../components/SiteFooter.tsx";
import SiteFooterLive from "../islands/SiteFooterLive.tsx";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";

function withLang<T>(lang: Lang, fn: () => T): T {
  const before = langSignal.value;
  langSignal.value = lang;
  try {
    return fn();
  } finally {
    langSignal.value = before;
  }
}

Deno.test("REQ-367: onLangChange reports every change of the app language after it subscribes — never the value the signal holds now", () => {
  const seen: Lang[] = [];
  withLang("es", () => {
    const stop = onLangChange((l) => seen.push(l));
    assertEquals(seen, [], "the value it holds now is not a choice");
    langSignal.value = "en";
    langSignal.value = "es";
    langSignal.value = "es"; // no change, no call
    stop();
    langSignal.value = "en"; // unsubscribed
  });
  assertEquals(seen, ["en", "es"]);
});

Deno.test("REQ-367: DocTitle paints the page's SSR language and carries both languages for the switch", () => {
  const html = renderToString(
    <DocTitle lang="es" title={(l) => tFor(l, "clientsRoute.docTitle")} />,
  );
  const doc = new DOMParser().parseFromString(
    `<html><head>${html}</head><body></body></html>`,
    "text/html",
  )!;
  const el = doc.querySelector("title")!;
  assertEquals(el.textContent, "Clientes · DocuMonster", "the SSR language");
  assertEquals(el.getAttribute(titleAttr("en")), "Customers · DocuMonster");
  assertEquals(el.getAttribute(titleAttr("es")), "Clientes · DocuMonster");
  assertEquals(liveTitle(doc, "en"), "Customers · DocuMonster");
  assertEquals(liveTitle(doc, "es"), "Clientes · DocuMonster");
});

Deno.test("REQ-367: followTitle sets the tab title to the language's DocTitle, and leaves a title that is not live alone", () => {
  const attrs: Record<string, string> = {
    [titleAttr("en")]: "Settings · DocuMonster",
    [titleAttr("es")]: "Configuración · DocuMonster",
  };
  const live = {
    title: "Settings · DocuMonster",
    querySelector: (_: string) => ({
      getAttribute: (n: string) => attrs[n] ?? null,
    }),
  };
  followTitle(live, "es");
  assertEquals(live.title, "Configuración · DocuMonster");
  followTitle(live, "en");
  assertEquals(live.title, "Settings · DocuMonster");

  // a landing's own title (its script swaps it) and a page with none stay as they are
  const landing = {
    title: "DocuMonster — Cotiza",
    querySelector: (_: string) => ({ getAttribute: (_n: string) => null }),
  };
  followTitle(landing, "en");
  assertEquals(landing.title, "DocuMonster — Cotiza");
  const none = { title: "x", querySelector: (_: string) => null };
  followTitle(none, "en");
  assertEquals(none.title, "x");
});

Deno.test("REQ-367: the footer paints its SSR language first whatever the app language holds — hydration matches the server", () => {
  for (
    const [ssr, app, terms] of [
      ["es", "en", "Términos de servicio"],
      ["en", "es", "Terms of Service"],
    ] as const
  ) {
    const html = withLang(app, () => renderToString(<SiteFooter lang={ssr} />));
    assert(
      html.includes(`>${terms}<`),
      `SSR ${ssr} under app language ${app}: ${html}`,
    );
  }
});

Deno.test("REQ-367: the footer island carries both languages' words as props, so the switch needs no dictionary in the browser", () => {
  const copy = { en: siteFooterCopy("en"), es: siteFooterCopy("es") };
  assertEquals(copy.en.policiesAria, "Policies");
  assertEquals(copy.es.policiesAria, "Políticas");
  assertEquals(copy.en.links.map((l) => l.label), [
    "Terms of Service",
    "Refund & Cancellation Policy",
    "Privacy Policy",
    "SMS Terms & Conditions",
  ]);
  assertEquals(copy.es.links.map((l) => l.label), [
    "Términos de servicio",
    "Política de reembolsos y cancelaciones",
    "Política de privacidad",
    "Términos y condiciones de SMS",
  ]);
  // the links are the one list's, in its order (REQ-067/076)
  for (const l of ["en", "es"] as const) {
    assertEquals(
      copy[l].links.map((x) => [x.id, x.path]),
      LEGAL_LINKS.map((x) => [x.id, x.path]),
    );
  }
  const es = renderToString(<SiteFooterLive lang="es" copy={copy} />);
  assert(es.includes('data-legal-link="terms"'), es);
  assert(es.includes(">Términos de servicio<"), es);
  assert(es.includes('aria-label="Políticas"'), es);
  const terms = new DOMParser().parseFromString(es, "text/html")!
    .querySelector("[data-legal-link='terms']");
  assert(
    terms?.hasAttribute("data-terms-link"),
    "REQ-043's hook stays on Terms",
  );
  const en = renderToString(<SiteFooterLive lang="en" copy={copy} />);
  assert(en.includes(">Terms of Service<"), en);
  assert(en.includes('aria-label="Policies"'), en);
});
