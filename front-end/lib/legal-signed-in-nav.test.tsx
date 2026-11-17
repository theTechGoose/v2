/**
 * REQ-510 (demo-loop cycle 3, issue m35) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * /terms said "Log in" to a contractor who was signed in: LegalPage hard-coded
 * the website's Log in button. Signed in, the header's button is "Back to app"
 * → /dashboard; signed out it stays Log in → /login. Renders the real
 * component server side.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import LegalPage from "../components/LegalPage.tsx";

function headerButton(signedIn: boolean | undefined, lang: "en" | "es" = "en") {
  const html = renderToString(
    <LegalPage id="terms" lang={lang} signedIn={signedIn} />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const btn = doc.querySelector(".nav-wrap .nav a.btn-outline");
  assert(btn, "the header has its button");
  return {
    href: btn.getAttribute("href"),
    text: btn.textContent.trim(),
    loginLinks: doc.querySelectorAll('.nav-wrap a[href="/login"]').length,
  };
}

Deno.test("REQ-510 m35 signed in: the legal page's header offers Back to app → /dashboard, not Log in", () => {
  const b = headerButton(true);
  assertEquals(b.href, "/dashboard");
  assertEquals(b.text, "Back to app");
  assertEquals(b.loginLinks, 0, "no Log in link in the header");
});

Deno.test("REQ-510 m35 signed in, Spanish: Volver a la app → /dashboard", () => {
  const b = headerButton(true, "es");
  assertEquals(b.href, "/dashboard");
  assertEquals(b.text, "Volver a la app");
});

Deno.test("REQ-510 m35 signed out (or unknown): the header keeps Log in → /login", () => {
  for (const s of [false, undefined]) {
    const b = headerButton(s);
    assertEquals(b.href, "/login");
    assertEquals(b.text, "Log in");
  }
});
