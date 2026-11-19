/**
 * REQ-990 (LOOP-007 cycle 1, q1-70 + q1-78), amending REQ-323 / REQ-924.
 *
 * q1-70: the /customers board says "Nothing billed yet" / "Sin facturar" for a
 * customer never billed (REQ-323, `balanceDisplay` + `hasBilled`), while the
 * customer page (REQ-924, CustomerWorkspace's Balance KPI) says "All paid up" /
 * "Todo pagado" on `owedCents > 0` alone, beside "Invoices: 0".
 *
 * q1-78: a zero balance has three words — sidebar `customerWs.nav.paid`
 * ("Paid up" / "Al día"), KPI `customerWs.kpi.paidUp` ("All paid up" / "Todo
 * pagado"), board `clientsDisplay.balance.settled` ("Settled" / "Saldado").
 *
 * The fix gives the three surfaces ONE shared choice, `zeroBalanceKey(billed)`
 * in clients-display.ts (the board's REQ-323 rule), which the sidebar status
 * line and the workspace KPI call too.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import * as display from "./clients-display.ts";
import { balanceDisplay, hasBilled } from "./clients-display.ts";
import { tFor } from "./i18n.ts";
import type { Lang } from "./i18n.ts";
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };

type CardArg = Parameters<typeof balanceDisplay>[0];
const LANGS: Lang[] = ["en", "es"];
const DICTS: Record<Lang, Record<string, string>> = {
  en: en as Record<string, string>,
  es: es as Record<string, string>,
} as Record<Lang, Record<string, string>>;

function card(docs: Array<{ state: string }>): CardArg {
  return {
    id: "c1",
    name: "Neo Never",
    balanceCents: 0,
    documents: docs.map((d, i) => ({
      id: `inv${i}`,
      kind: "invoice",
      state: d.state,
    })),
  } as unknown as CardArg;
}

function zeroBalanceKey(): (billed: boolean) => string {
  const fn = (display as Record<string, unknown>).zeroBalanceKey;
  assertEquals(
    typeof fn,
    "function",
    "REQ-990: clients-display.ts exports zeroBalanceKey(billed) — the one zero-balance choice the board, the sidebar and the customer page share",
  );
  return fn as (billed: boolean) => string;
}

Deno.test("REQ-990 / REQ-323 (q1-70): a customer never billed reads Nothing billed yet / Sin facturar on every surface, never All paid up / Todo pagado", () => {
  const key = zeroBalanceKey();
  for (const lang of LANGS) {
    const nothing = tFor(lang, key(false));
    assertEquals(
      nothing,
      tFor(lang, "clientsDisplay.balance.nothingBilled"),
      `${lang}: never billed → nothing billed`,
    );
    assertNotEquals(nothing, tFor(lang, "customerWs.kpi.paidUp"));
    for (const docs of [[], [{ state: "draft" }], [{ state: "void" }]]) {
      const c = card(docs);
      assert(!hasBilled(c), `no issued invoice in ${JSON.stringify(docs)}`);
      assertEquals(
        tFor(lang, key(hasBilled(c))),
        balanceDisplay(c, lang).text,
        `${lang} ${JSON.stringify(docs)}: the shared choice = the board`,
      );
    }
    const paid = card([{ state: "paid" }]);
    assertEquals(
      tFor(lang, key(hasBilled(paid))),
      balanceDisplay(paid, lang).text,
      `${lang}: billed and paid → the board's settled word`,
    );
  }
});

Deno.test("REQ-990 (q1-78): a billed customer with nothing owed has ONE word in en and es — sidebar, customer-page KPI and board agree", () => {
  for (const lang of LANGS) {
    const dict = DICTS[lang];
    const board = balanceDisplay(card([{ state: "paid" }]), lang).text;
    // every zero-balance key still in the dictionary must say the board's word
    for (const k of ["customerWs.nav.paid", "customerWs.kpi.paidUp"]) {
      if (!(k in dict)) continue; // retired by the fix — fine
      assertEquals(
        dict[k],
        board,
        `${lang}: "${k}" says "${dict[k]}" but the board says "${board}"`,
      );
    }
  }
});
