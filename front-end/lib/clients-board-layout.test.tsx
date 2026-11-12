/**
 * REQ-419 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 2, issues m40 / S7c / p13-k on /customers (ClientsBoard):
 *  - m40: the card's back panel is pinned to the front's height and its row groups
 *    shrank (flex items with overflow:hidden) — ADDRESS and DOCUMENTS were clipped.
 *  - S7c: the closed back panel was hidden with opacity only, so screen readers (and
 *    the agent's accessibility snapshot) read it, and its tel:/mailto: links took focus.
 *  - p13-k: "Page 1 of 1" sat in the cards grid's next cell, beside a lone card.
 *
 * The board is rendered for real (SSR) and the stylesheet is read as shipped.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import ClientsBoard from "../islands/ClientsBoard.tsx";
import type { CustomerCard } from "../clients/clients.ts";

const card: CustomerCard = {
  id: "c1",
  userId: "u1",
  name: "Dana Reyes",
  number: "C-001",
  phoneNumber: "(512) 555-3150",
  email: "dana@example.com",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  lastWhen: null,
  lastTone: "hot",
  balanceCents: 0,
  balanceSub: "settled",
  activeJobs: 0,
  jobsSub: "none",
  status: "lead",
  temp: 80,
  daysSinceContact: 0,
  revenue12moCents: 0,
  documents: [],
};

const counts = {
  all: 1,
  new: 0,
  active: 0,
  lead: 1,
  owes: 0,
  regular: 0,
  cold: 0,
};

function board(totalPages: number, cards: CustomerCard[] = [card]) {
  const html = renderToString(
    <ClientsBoard
      cards={cards}
      counts={counts}
      rosterEmpty={false}
      query=""
      onQuery={() => {}}
      filter="all"
      onFilter={() => {}}
      page={1}
      totalPages={totalPages}
      onPage={() => {}}
      lang="en"
    />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}

function cssBlock(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  assert(m, `clients.css has a ${selector} rule`);
  return m[1];
}

Deno.test("REQ-419 (S7c) the closed card's back panel is out of the accessibility tree and the tab order", () => {
  const doc = board(1);
  const panel = doc.querySelector(".ccard2__panel") as Element | null;
  assert(panel, "the card renders its back panel");
  assertEquals(
    panel.getAttribute("aria-hidden"),
    "true",
    "closed → aria-hidden",
  );
  assert(
    panel.hasAttribute("inert"),
    "closed → inert (its links take no focus)",
  );
});

Deno.test("REQ-419 (p13-k) one page: no pager at all", () => {
  const doc = board(1);
  assertEquals(doc.querySelector(".cpager"), null, "no 'Page 1 of 1'");
  assertEquals(doc.querySelector("[data-cy='clients-pager']"), null);
});

Deno.test("REQ-419 (p13-k) several pages: the pager renders below the grid, never in a card's cell", () => {
  const doc = board(2);
  const pager = doc.querySelector(".cpager") as Element | null;
  assert(pager, "two pages → the pager shows");
  assert(pager.textContent.includes("Page 1 of 2"), pager.textContent);
  assert(
    !pager.parentElement?.closest(".ccards2") &&
      pager.parentElement?.getAttribute("class") !== "ccards2",
    "the pager is not a child of the cards grid",
  );
});

Deno.test("REQ-419 (m40) the back panel scrolls as a whole and its row groups never shrink", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/clients.css", import.meta.url),
  );
  const panel = cssBlock(css, ".ccard2__panel");
  assert(
    /overflow-y:\s*auto/.test(panel),
    "the panel scrolls: overflow-y:auto",
  );
  const rows = cssBlock(css, ".ccard2__panel-rows");
  assert(
    /flex-shrink:\s*0/.test(rows),
    "row groups keep their height: flex-shrink:0",
  );
  const head = cssBlock(css, ".ccard2__panel-head");
  assert(
    /flex-shrink:\s*0/.test(head),
    "the panel head keeps its height: flex-shrink:0",
  );
  // S7c belt and braces: a closed panel is visibility:hidden (after its fade), open is visible
  assert(
    /visibility:\s*hidden/.test(panel),
    "closed panel is visibility:hidden",
  );
  const open = cssBlock(css, ".ccard2--open .ccard2__panel");
  assert(/visibility:\s*visible/.test(open), "open panel is visible");
});
