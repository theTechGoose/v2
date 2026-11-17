/**
 * REQ-802 — "the customers tab has no delete customer tab on the customer
 * cards." Every /customers card's panel carries a Delete customer action with
 * an inline confirm; confirming soft-deletes through DELETE /customers/:id
 * and the card leaves the board. Wiring is asserted on the island source
 * (the islands are Preact and the unit project has no DOM); the strings on
 * both language files.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const lang = (l: string) =>
  JSON.parse(read(`lang/${l}.json`)) as Record<string, string>;

const KEYS = [
  "clientsBoard.panel.delete",
  "clientsBoard.panel.deleteAsk",
  "clientsBoard.panel.deleteYes",
  "clientsBoard.panel.deleteKeep",
  "clientsBoard.panel.deleteError",
  "clientsPage.deleted",
];

describe("REQ-802 — Delete customer on the card", () => {
  it("REQ-802 clientsClient.delete calls DELETE /customers/:id", () => {
    const src = read("front-end/clients/clients.ts");
    expect(src).toMatch(
      /delete:\s*\(id: string[^)]*\)\s*=>\s*api\.delete<\{ ok: true \}>\(`\/customers\/\$\{id\}`/,
    );
  });

  it("REQ-802 the card panel renders the action, the inline question and both buttons, wired to the client", () => {
    const board = read("front-end/islands/ClientsBoard.tsx");
    expect(board).toContain('data-cy="ccard2-delete"');
    expect(board).toContain('data-cy="ccard2-delete-ask"');
    expect(board).toContain('data-cy="ccard2-delete-yes"');
    expect(board).toContain('data-cy="ccard2-delete-keep"');
    expect(board).toContain('data-cy="ccard2-delete-error"');
    expect(board).toMatch(/clientsClient\.delete\(c\.id\)/);
    // the action is a quiet danger button, never a filled primary
    expect(board).toContain("ccard2__panel-act--danger");
    // the page is told, with the card, so it can close the sheet and flash
    expect(board).toMatch(/onDeleted\(c\)/);
    expect(board).toMatch(/onDeleted\?: \(c: CustomerCard\) => void/);
    for (const k of KEYS.filter((k) => k.startsWith("clientsBoard"))) {
      expect(board).toContain(`"${k}"`);
    }
  });

  it("REQ-802 the page re-reads its cards, closes the sheet of the deleted customer and flashes", () => {
    const page = read("front-end/islands/ClientsPage.tsx");
    expect(page).toMatch(/onDeleted=\{/);
    expect(page).toMatch(/function onCustomerDeleted\(/);
    expect(page).toContain('"clientsPage.deleted"');
    expect(page).toMatch(/refreshClients\(\)/);
  });

  it("REQ-802 AMENDMENT the client sheet (Open card) has the same action, question and buttons, wired to the page", () => {
    const sheet = read("front-end/components/ClientSheet.tsx");
    for (
      const cy of [
        "client-sheet-delete",
        "client-sheet-delete-ask",
        "client-sheet-delete-yes",
        "client-sheet-delete-keep",
        "client-sheet-delete-error",
      ]
    ) {
      expect(sheet).toContain(`data-cy="${cy}"`);
    }
    expect(sheet).toMatch(/clientsClient\.delete\(c\.id\)/);
    expect(sheet).toMatch(/onDeleted\?: \(c: CustomerCard\) => void/);
    // the sheet's one solid primary stays Edit; Delete is outlined
    expect(sheet).toMatch(/BTN_DANGER =\s*"[^"]*background:transparent/);
    const page = read("front-end/islands/ClientsPage.tsx");
    expect(page).toMatch(/<ClientSheet[\s\S]*?onDeleted=\{onCustomerDeleted\}/);
  });

  it("REQ-802 the danger style exists in clients.css", () => {
    const css = read("front-end/static/clients.css");
    expect(css).toMatch(/\.ccard2__panel-act--danger\s*\{/);
    expect(css).toMatch(/\.ccard2__panel-act--ghost\s*\{/);
  });

  it("REQ-802 every string exists in en and es; the es ones are Spanish", () => {
    const en = lang("en");
    const es = lang("es");
    for (const k of KEYS) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
    }
    expect(en["clientsBoard.panel.delete"]).toBe("Delete customer");
    expect(es["clientsBoard.panel.delete"]).toBe("Eliminar cliente");
    expect(en["clientsBoard.panel.deleteAsk"]).toContain("{name}");
    expect(es["clientsBoard.panel.deleteAsk"]).toContain("{name}");
    expect(en["clientsPage.deleted"]).toBe("{name} deleted");
    expect(es["clientsPage.deleted"]).toContain("{name}");
  });
});
