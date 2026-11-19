/**
 * REQ-1075 (LOOP-007 cycle 2, q2-65) — "No Delete action on the customer's own
 * page". The full customer page (/customers/<id>, island CustomerWorkspace,
 * REQ-924) must offer Delete customer in its More menu with REQ-802's inline
 * confirm (question naming the customer, a red Delete, a ghost Keep, an inline
 * error — no native dialog), wired to clientsClient.delete; confirming tells
 * the sidebar and lands on /customers. Wiring is asserted on the island source
 * (plus any component it imports for the confirm — the unit project has no
 * DOM); strings on both language files.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const lang = (l: string) =>
  JSON.parse(read(`lang/${l}.json`)) as Record<string, string>;

const WS = "front-end/islands/CustomerWorkspace.tsx";

/** the island plus any local component it imports whose name mentions Delete (a lifted shared confirm) */
function workspaceSources(): string {
  const ws = read(WS);
  const extra: string[] = [];
  for (
    const m of ws.matchAll(/from\s+"(\.\.\/components\/[^"]*Delete[^"]*)"/g)
  ) {
    const rel = path.join("front-end/islands", m[1]);
    if (fs.existsSync(path.join(ROOT, rel))) extra.push(read(rel));
  }
  return [ws, ...extra].join("\n");
}

/** the More menu's JSX: from data-cy="cws-menu" to the end of its block */
function moreMenu(): string {
  const ws = read(WS);
  const at = ws.indexOf('data-cy="cws-menu"');
  expect(at).toBeGreaterThan(-1);
  const end = ws.indexOf("</header>", at);
  return ws.slice(at, end === -1 ? at + 4000 : end);
}

describe("REQ-1075 (q2-65) — Delete customer on the customer's own page", () => {
  it("REQ-1075 the More menu (cws-menu) carries a Delete customer item, data-cy cws-delete, styled as quiet danger", () => {
    const menu = moreMenu();
    expect(menu).toContain('data-cy="cws-delete"');
    // the existing three items stay
    expect(menu).toContain('data-cy="cws-edit"');
    expect(menu).toContain('data-cy="cws-start-service"');
    // a danger item, never a filled primary
    expect(menu).toMatch(
      /cws-delete[\s\S]{0,400}danger|danger[\s\S]{0,400}cws-delete/,
    );
  });

  it("REQ-1075 the item opens REQ-802's inline confirm: question, Delete, Keep, inline error — no native confirm()", () => {
    const src = workspaceSources();
    for (
      const cy of [
        "cws-delete-ask",
        "cws-delete-yes",
        "cws-delete-keep",
        "cws-delete-error",
      ]
    ) {
      expect(src).toContain(`data-cy="${cy}"`);
    }
    expect(src).not.toMatch(/\bconfirm\(/);
    // the question and the buttons reuse REQ-802's strings
    for (
      const k of [
        "clientsBoard.panel.deleteAsk",
        "clientsBoard.panel.deleteYes",
        "clientsBoard.panel.deleteKeep",
      ]
    ) {
      expect(src).toContain(`"${k}"`);
    }
  });

  it("REQ-1075 confirming calls clientsClient.delete with the page's customer id, tells the sidebar and lands on /customers", () => {
    const src = workspaceSources();
    expect(src).toMatch(/clientsClient\.delete\(\s*[\w.]*id\s*\)/);
    const ws = read(WS);
    expect(ws).toMatch(
      /import\s*\{[^}]*\bclientsClient\b[^}]*\}\s*from\s*"\.\.\/clients\/clients\.ts"|DeleteCustomer/,
    );
    // the sidebar's customer rows re-read (CUSTOMERS_CHANGED) and the page leaves for the board
    expect(src).toMatch(/CUSTOMERS_CHANGED/);
    expect(src).toMatch(
      /location\.(assign|replace|href)\s*[(=]\s*[`"']\/customers(\?|[`"'])/,
    );
  });

  it("REQ-1075 the label reads Delete customer / Eliminar cliente in en and es", () => {
    const menu = moreMenu();
    const key = menu.match(
      /tFor\(lang,\s*"((?:customerWs\.act|clientsBoard\.panel)\.delete[A-Za-z]*)"\)/,
    )?.[1];
    expect(key).toBeDefined();
    expect(lang("en")[key!]).toBe("Delete customer");
    expect(lang("es")[key!]).toBe("Eliminar cliente");
  });
});
