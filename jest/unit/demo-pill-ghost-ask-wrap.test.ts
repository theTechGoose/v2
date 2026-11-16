/**
 * REQ-851 — demo-loop cycle dm3, issue p3 (amends REQ-835): at narrow widths the stage's copy of
 * End's question wrapped into 3 rows (header, question, answers) where the customer's pill has 2
 * (header; question with "Yes, end it" and "Keep going" beside it).
 *
 * EndDemo puts the question and both answers in ONE group (`[data-cy=demo-end-ask]`) and, with
 * `ownRow`, that GROUP takes the row (`flex-basis:100%`) and wraps inside itself. REQ-835's
 * `ghostFlow.ask` (`flex:1 0 100%`) gave the full row to the question alone, with the answers as
 * sibling flex items of the ghost — so they always fell to a third row.
 */
import * as fs from "fs";
import * as path from "path";
import { ghostFlow } from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  expect(i).toBeGreaterThanOrEqual(0);
  const j = s.indexOf(b, i + a.length);
  expect(j).toBeGreaterThan(i);
  return s.slice(i, j);
};
/** "a:b;c:d" → { a: "b", c: "d" } */
const decls = (css: string) =>
  Object.fromEntries(
    css.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }),
  );

describe("REQ-851 (demo-loop cycle dm3, p3): the stage's ghost of End's question draws the customer's rows", () => {
  test("REQ-851 unit: a wrapping ghost's `ask` is the question GROUP's flow — EndDemo's ownRow (inline-flex, wraps inside, takes the row, may shrink) — and the question in it is flex:0 1 auto", () => {
    const w = ghostFlow(true);
    const ask = decls(w.ask);
    expect(ask.display).toBe("inline-flex");
    expect(ask["flex-wrap"]).toBe("wrap");
    expect(ask["align-items"]).toBe("center");
    expect(ask["min-width"]).toBe("0");
    // the group, not the question, takes the row
    expect(w.ask).toMatch(/flex-basis:100%|flex:\d \d 100%/);
    const q = decls(w.q);
    expect(q.flex).toBe("0 1 auto");
    expect(w.q).not.toMatch(/100%/);
    expect(w.q).not.toMatch(/text-overflow:ellipsis/);
  });

  test("REQ-851 unit: the ghost's group carries every layout declaration of EndDemo's ownRow group", () => {
    const end = read("front-end/components/demo-mode/EndDemo.tsx");
    const style = between(end, 'data-cy="demo-end-ask"', "</span>");
    const base = style.match(/"(display:inline-flex[^"]*)"/);
    const own = style.match(/ownRow \? "([^"]*)"/);
    expect(base).not.toBeNull();
    expect(own).not.toBeNull();
    const want = decls(`${base![1]};${own![1]}`);
    const ask = decls(ghostFlow(true).ask);
    for (const k of ["display", "align-items", "flex-wrap", "min-width"]) {
      expect([k, ask[k]]).toEqual([k, want[k]]);
    }
    expect(want["flex-basis"]).toBe("100%");
    expect(ask["flex-basis"] ?? ask.flex?.split(" ")[2]).toBe("100%");
  });

  test("REQ-851 unit: a one-row ghost keeps the group on the row and cuts only the question", () => {
    const one = ghostFlow(false);
    const ask = decls(one.ask);
    expect(ask.display).toBe("inline-flex");
    expect(ask["flex-wrap"]).toBe("nowrap");
    expect(ask["min-width"]).toBe("0");
    expect(one.ask).not.toMatch(/100%/);
    expect(one.q).toMatch(/text-overflow:ellipsis/);
    expect(one.q).toMatch(/min-width:0/);
  });

  test("REQ-851 wiring: the stage wraps the question, Yes and No in ONE group span styled by flow.ask; the question is styled by flow.q", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    const ghost = between(
      s,
      'data-cy="demo-pill-ghost"',
      'data-cy="demo-pill-ghost-clipped"',
    );
    const group = between(
      ghost,
      'data-cy="demo-pill-ghost-asking"',
      "{words.end &&",
    );
    expect(group).toMatch(/style=\{`\$\{flow\.ask\}/);
    const ask = between(group, 'data-cy="demo-pill-ghost-ask"', ">");
    expect(ask).toMatch(/style=\{flow\.q\}/);
    expect(group).toMatch(/data-cy="demo-pill-ghost-yes"/);
    expect(group).toMatch(/data-cy="demo-pill-ghost-no"/);
    // the three are children of the group, never siblings of it
    const yes = group.indexOf('data-cy="demo-pill-ghost-yes"');
    const no = group.indexOf('data-cy="demo-pill-ghost-no"');
    const close = group.lastIndexOf("</span>");
    expect(yes).toBeGreaterThan(0);
    expect(no).toBeGreaterThan(yes);
    expect(close).toBeGreaterThan(no);
  });

  test("REQ-851 wiring: the pill's ResizeObserver re-places (clamp + send) at once while End asks — the wrap reflow reaches the stage without waiting for the debounce", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    const fx = between(
      o,
      "REQ-835 / REQ-830 (reconciled on demo-fixes) — sendPill lives",
      "ro?.disconnect();",
    );
    const resized = between(fx, "const resized = () => {", "\n    };");
    expect(resized).toMatch(
      /querySelector\('\[data-cy="demo-end-ask"\]'\)\) place\(\);/,
    );
    expect(resized).toMatch(/later\(\);/);
    expect(fx).toMatch(/new ResizeObserver\(resized\)/);
  });
});
