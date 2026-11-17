import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { fenceClicks, isChromeClick } from "./backdrop-dismiss.ts";

/**
 * REQ-432 (demo-loop cycle 3, issues m29 + m40): an open customer card
 * collapsed when the user tapped "End demo" on the demo pill, or switched
 * EN/ES in the topbar — ClientsBoard's document-level outside-click treated
 * every click outside `.ccard2` as "dismiss". Clicks on the app's chrome
 * (topbar, sidebar, the demo overlay, anything marked data-keep-open) are
 * not "outside" clicks, and the demo overlay keeps its clicks to itself.
 */

const html = `
<body>
  <header class="topbar"><div class="topbar__lang"><button id="es">ES</button></div></header>
  <aside class="sidebar"><a id="nav" href="/customers">Customers</a></aside>
  <div data-demo-overlay><div data-cy="demo-pill"><button id="end">End demo</button></div></div>
  <div data-keep-open><button id="kept">kept</button></div>
  <main><div class="board"><button id="page">elsewhere</button></div></main>
</body>`;
const doc = new DOMParser().parseFromString(html, "text/html");
const el = (id: string) => doc.getElementById(id) as unknown as Element;

Deno.test("REQ-432 isChromeClick: the topbar's EN/ES switch, the sidebar, the demo pill's End and data-keep-open are chrome", () => {
  assert(isChromeClick(el("es")), "topbar lang button");
  assert(isChromeClick(el("nav")), "sidebar link");
  assert(isChromeClick(el("end")), "demo overlay End button");
  assert(isChromeClick(el("kept")), "data-keep-open");
});

Deno.test("REQ-432 isChromeClick: a click on the page body is not chrome; null / text-ish targets are not chrome", () => {
  assertEquals(isChromeClick(el("page")), false);
  assertEquals(isChromeClick(null), false);
  assertEquals(isChromeClick({}), false);
});

Deno.test("REQ-432 fenceClicks: the overlay root stops click, pointerdown and mousedown in the bubble phase — once", () => {
  const added: { type: string; capture: unknown }[] = [];
  const handlers: Record<string, (e: { stopPropagation(): void }) => void> = {};
  const root = {
    addEventListener(
      type: string,
      fn: (e: { stopPropagation(): void }) => void,
      opts?: unknown,
    ) {
      added.push({ type, capture: opts });
      handlers[type] = fn;
    },
  };
  fenceClicks(root as unknown as HTMLElement);
  fenceClicks(root as unknown as HTMLElement); // a re-render's ref call adds nothing
  fenceClicks(null); // unmount
  assertEquals(added.map((a) => a.type).sort(), [
    "click",
    "mousedown",
    "pointerdown",
  ]);
  // bubble phase: capture-phase document listeners (presence, End's ask-cancel) still hear it
  assert(added.every((a) => a.capture === undefined || a.capture === false));
  for (const type of ["click", "pointerdown", "mousedown"]) {
    let stopped = false;
    handlers[type]({ stopPropagation: () => (stopped = true) });
    assert(stopped, `${type} stopped`);
  }
});

Deno.test("REQ-432 wiring: ClientsBoard's outside-click ignores chrome; every demo overlay root is fenced", async () => {
  const board = await Deno.readTextFile(
    new URL("../islands/ClientsBoard.tsx", import.meta.url),
  );
  assert(
    /isChromeClick\(target\)/.test(board),
    "ClientsBoard's onDocClick asks isChromeClick(target)",
  );
  const overlay = await Deno.readTextFile(
    new URL("../islands/DemoModeOverlay.tsx", import.meta.url),
  );
  const roots = overlay.match(/<div data-demo-overlay[^>]*>/g) ?? [];
  assert(roots.length >= 4, `found the overlay roots (${roots.length})`);
  for (const r of roots) {
    assert(r.includes("ref={fenceClicks}"), `fenced: ${r}`);
  }
});
