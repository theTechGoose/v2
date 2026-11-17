/**
 * REQ-604 (demo-loop cycle 4, issue m18) — the real DashSidebar island, rendered: a super-admin
 * sees the Admin tab on the sidebar root (not only inside the Roles folder), /admin rests on the
 * root so its active row is in view, a non-super-admin never sees it, and /field/workers opens
 * inside Field with Workers active.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DashSidebar from "../islands/DashSidebar.tsx";
import { _resetForTest } from "./dash-cache.ts";
import { restingPath } from "./sb-drawer.ts";

const KEY = "pm:dash-cache:v1";

function render(active: string, superAdmin: boolean) {
  _resetForTest();
  globalThis.sessionStorage.setItem(
    KEY,
    JSON.stringify({
      stats: null,
      profile: { user: { language: "en", superAdmin, name: "Hans" } },
    }),
  );
  const html = renderToString(<DashSidebar active={active} />);
  _resetForTest();
  return new DOMParser().parseFromString(html, "text/html")!;
}

const labels = (doc: ReturnType<typeof render>) =>
  [...doc.querySelectorAll(".sb__nav .nav-item__label")].map((e) =>
    e.textContent.trim()
  );

Deno.test("REQ-604 m18: a super-admin on the dashboard sees the Admin tab on the sidebar root", () => {
  const doc = render("home", true);
  assert(doc.querySelector(".sb__nav a[href='/admin']"), "Admin link on root");
  assert(!doc.querySelector("[data-cy='nav-back']"), "this is the root");
  assertEquals(labels(doc).includes("Admin"), true);
});

Deno.test("REQ-604 m18: a non-super-admin never sees the Admin tab", () => {
  assertEquals(render("home", false).querySelector("a[href='/admin']"), null);
});

Deno.test("REQ-604 m18: /admin rests on the root with its Admin row active", () => {
  assertEquals(restingPath("admin"), []);
  const doc = render("admin", true);
  assert(doc.querySelector(".sb__nav a[href='/admin'].nav-item--active"));
});

Deno.test("REQ-604 m18: /field/workers opens inside Field, Workers active, next to the field pages", () => {
  const doc = render("workers", false);
  assert(doc.querySelector("[data-cy='nav-back']"), "inside a folder");
  // SSR renders the island's default language; either way the open folder is Field / Campo
  assert(
    /^(Field|Campo)$/.test(
      doc.querySelector("[data-cy='nav-folder-name']")?.textContent.trim() ??
        "",
    ),
    "the open folder is Field",
  );
  assert(doc.querySelector("a[href='/field/workers'].nav-item--active"));
  assert(doc.querySelector("a[href='/field/tasks']"));
});
