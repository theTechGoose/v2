/**
 * REQ-358 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo issue m45 (cycle 1): the phone drawer had no close button, covered the ☰
 * that would toggle it shut, and re-opened on the last folder browsed (Billing)
 * instead of the page's own.
 *
 * The rule: the drawer's head carries a ✕ (44 px, phone widths only) labelled in
 * the UI language; Escape closes it too; and every close — ✕, backdrop, ☰,
 * Escape — puts the sidebar back at the page's resting folder (`restingPath`).
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DashSidebar from "../islands/DashSidebar.tsx";
import { restingPath } from "./sb-drawer.ts";

const SRC = Deno.readTextFileSync(
  new URL("../islands/DashSidebar.tsx", import.meta.url),
);
const lang = (l: string) =>
  JSON.parse(
    Deno.readTextFileSync(new URL(`../../lang/${l}.json`, import.meta.url)),
  ) as Record<string, string>;

Deno.test("REQ-358 the resting folder: the active page's folder, Admin for the super-admin tab, the root otherwise", () => {
  assertEquals(restingPath("quotes"), ["billing"]);
  assertEquals(restingPath("tasks"), ["field"]); // REQ-361: the folder is "field" now
  assertEquals(restingPath("admin"), ["manage"]);
  assertEquals(restingPath("home"), []);
  assertEquals(restingPath("customers"), []);
  assertEquals(restingPath(undefined), []);
});

Deno.test("REQ-358 the drawer's head renders a labelled ✕ close button", () => {
  const html = renderToString(<DashSidebar active="home" />);
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const btn = doc.querySelector(".sb__head button.sb__close");
  assert(btn, "a .sb__close button inside .sb__head");
  assertEquals(btn.getAttribute("type"), "button");
  assertEquals(btn.getAttribute("data-cy"), "sb-close");
  assert(
    (btn.getAttribute("aria-label") ?? "").length > 0,
    "the ✕ carries an aria-label",
  );
});

Deno.test("REQ-358 the ✕ is phone-only and 44 px, its rules ride with the island (every page that mounts the sidebar gets them)", () => {
  const html = renderToString(<DashSidebar active="home" />);
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1]).join("\n");
  assert(/\.sb__close\s*\{[^}]*display:\s*none/.test(css), "hidden by default");
  const phone = css.match(/@media \(max-width: 640px\)\s*\{([\s\S]*)\}/);
  assert(phone, "a ≤640px block");
  assert(/\.sb__close\s*\{[^}]*display:\s*inline-flex/.test(phone[1]));
  assert(/\.sb__close\s*\{[^}]*width:\s*44px/.test(phone[1]));
  assert(/\.sb__close\s*\{[^}]*height:\s*44px/.test(phone[1]));
});

Deno.test("REQ-358 the close label is in both dictionaries", () => {
  assertEquals(lang("en")["nav.closeMenu"], "Close menu");
  assertEquals(lang("es")["nav.closeMenu"], "Cerrar menú");
});

Deno.test("REQ-358 every close resets the folder: the island resets path to restingPath(active) when the drawer goes from open to closed, and Escape closes it", () => {
  assert(
    /useEffect\(\(\) => \{[\s\S]*?!mobileOpen[\s\S]*?setPath\(restingPath\(active\)\)[\s\S]*?\}, \[mobileOpen\]\)/
      .test(SRC),
    "an effect on [mobileOpen] resets path to restingPath(active) on close",
  );
  assert(
    /e\.key === "Escape"[\s\S]{0,80}setMobileOpen\(false\)/.test(SRC),
    "Escape closes the drawer",
  );
  assert(
    /class="sb__close"[\s\S]{0,200}onClick=\{\(\) => setMobileOpen\(false\)\}/
      .test(SRC),
    "the ✕ closes the drawer",
  );
});
