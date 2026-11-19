/**
 * REQ-1020 (LOOP-007 cycle 2, issue q2-11) — "Customer page Invoices table is
 * clipped at 390px: SALDO column and Remind / Mark paid actions are off-screen".
 *
 * The customer workspace tables (payments, visits, jobs, invoices / Resumen
 * unpaid, quotes) are bare `<table class="cws-table">` inside `.cws-card`. At
 * ≤640px the only table rules hide the 2nd column and stack the row buttons,
 * so the invoice table keeps a ~574px min-content width inside a 322px card.
 * REQ-353 clips `.main` sideways (`overflow-x: clip`), so the overflow is cut
 * off and cannot be scrolled: SALDO and the Remind / Mark paid buttons are
 * unreachable on a phone.
 *
 * The fix either makes every cws-table a stacked card at ≤640px (table, tbody,
 * tr, td `display:block`, thead hidden — as the Outbox does), or wraps every
 * `<table class="cws-table">` in a local horizontal scroller
 * (`overflow-x: auto`) that REQ-353's clip on main does not swallow.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const squash = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

const CSS = squash(read("front-end/static/customer-workspace.css"));
const TSX = read("front-end/islands/CustomerWorkspace.tsx");

/** the bodies of every `@media (max-width: N)` block with N ≤ 640 */
function phoneBlocks(css: string): string {
  const out: string[] = [];
  const re = /@media\(max-width:(\d+)px\)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (Number(m[1]) > 640) continue;
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out.join("");
}

/** every `selector{decls}` rule in a flat css string */
function rules(css: string): { sel: string; decl: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1],
    decl: m[2],
  }));
}

const PHONE = phoneBlocks(CSS);

/** a ≤640px rule makes `.cws-table <part>` display:block */
function phoneDisplays(part: string): boolean {
  return rules(PHONE).some((r) =>
    r.sel.split(",").some((s) => new RegExp(`\\.cws-table${part}$`).test(s)) &&
    /display:(block|grid|flex)/.test(r.decl)
  );
}

function cardLayoutFull(): { ok: boolean; why: string } {
  const tr = phoneDisplays("tr") || phoneDisplays("tbodytr");
  const td = phoneDisplays("td") || phoneDisplays("trtd") ||
    phoneDisplays("tbodytrtd");
  const thead = rules(PHONE).some((r) =>
    r.sel.split(",").some((s) => /\.cws-tablethead$/.test(s)) &&
    /display:none/.test(r.decl)
  );
  return {
    ok: tr && td && thead,
    why: `tr block=${tr} td block=${td} thead hidden=${thead}`,
  };
}

/** class names whose rule sets overflow-x auto/scroll */
function scrollerClasses(): string[] {
  return rules(CSS)
    .filter((r) => /overflow(-x)?:(auto|scroll)/.test(r.decl))
    .flatMap((r) => r.sel.split(","))
    .map((s) => s.match(/^\.([\w-]+)$/)?.[1])
    .filter((c): c is string => !!c);
}

/** each `<table class="cws-table"` in the island, with whether its direct parent element is a scroller */
function tableWrapping(): { line: number; cy: string; wrapped: boolean }[] {
  const scrollers = scrollerClasses();
  const out: { line: number; cy: string; wrapped: boolean }[] = [];
  const re = /<table\s+class="cws-table"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(TSX))) {
    const before = TSX.slice(0, m.index);
    const opener = [...before.matchAll(/<div\b[^>]*class="([^"]+)"[^>]*>\s*$/g)]
      .pop();
    const parentClasses = opener ? opener[1].split(/\s+/) : [];
    out.push({
      line: before.split("\n").length,
      cy: (m[0].match(/data-cy=\{?"?([^"}\s]+)/) ?? [])[1] ?? "?",
      wrapped: parentClasses.some((c) => scrollers.includes(c)),
    });
  }
  return out;
}

describe("REQ-1020 q2-11 the customer workspace tables never spill off a 390px phone", () => {
  it("REQ-1020 q2-11 the island still renders the five cws tables (payments, visits, jobs, invoices/unpaid, quotes)", () => {
    expect(tableWrapping().length).toBeGreaterThanOrEqual(5);
  });

  it("REQ-1020 q2-11 at ≤640px every cws-table is a stacked card (tr/td display:block, thead hidden) OR sits in an overflow-x:auto wrapper", () => {
    const card = cardLayoutFull();
    const tables = tableWrapping();
    const unwrapped = tables.filter((t) => !t.wrapped).map((t) =>
      `${t.cy}@CustomerWorkspace.tsx:${t.line}`
    );
    const verdict = {
      cardLayout: card.why,
      scrollerClasses: scrollerClasses(),
      unwrappedTables: unwrapped,
    };
    // either fix is accepted; at the bug neither holds
    expect({ ok: card.ok || unwrapped.length === 0, ...verdict }).toEqual({
      ...verdict,
      ok: true,
    });
  });

  it("REQ-1020 q2-11 the ≤640px block does more than hide column 2 and stack .cws-rowact (the rules that left a 574px table in a 322px card)", () => {
    const tableRules = rules(PHONE)
      .filter((r) => /\.cws-(table|tablewrap|rowact)/.test(r.sel))
      .map((r) => `${r.sel}{${r.decl}}`);
    const onlyTheOldTwo = tableRules.every((r) =>
      /nth-child\(2\)/.test(r) || /^\.cws-rowact\{/.test(r)
    );
    expect({ onlyTheOldTwo, tableRules }).toEqual({
      onlyTheOldTwo: false,
      tableRules,
    });
  });
});
