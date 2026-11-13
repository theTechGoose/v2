/**
 * REQ-773 — Raphael: "fix every issue the demo found, loop until there are none." Demo issue
 * dv1-d1 (cycle dv1): testers asked "where is Quotes" — it was inside the Billing folder
 * (REQ-176). Raphael: "I don't understand what quotes inside the billing folder is ... Change
 * that." The sidebar's root renders Quotes as a link, on every page whose resting folder is the
 * root (the dashboard on desktop, and the phone drawer, which is the same island).
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DashSidebar from "../islands/DashSidebar.tsx";

const rootLinks = (active: string) => {
  const html = renderToString(<DashSidebar active={active} />);
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  return doc;
};

Deno.test("REQ-773 the dashboard's sidebar root renders a Quotes link, no folder to open", () => {
  const doc = rootLinks("home");
  assert(
    doc.querySelector(".sb__nav a.nav-item[href='/quotes']"),
    "a /quotes row on the root",
  );
  assertEquals(
    doc.querySelectorAll("[data-cy='nav-back']").length,
    0,
    "the dashboard rests at the root",
  );
  assert(
    doc.querySelector("[data-cy='nav-folder-billing']"),
    "Billing stays a folder (Invoices, Payments)",
  );
  assertEquals(
    doc.querySelectorAll(".sb__nav a.nav-item[href='/invoices']").length,
    0,
    "Invoices stays inside Billing",
  );
});

Deno.test("REQ-773 on /quotes the sidebar rests at the root with Quotes active", () => {
  const doc = rootLinks("quotes");
  assertEquals(doc.querySelectorAll("[data-cy='nav-back']").length, 0);
  assert(doc.querySelector(".sb__nav a.nav-item--active[href='/quotes']"));
});
