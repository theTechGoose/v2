/**
 * REQ-893 — demo-loop run 6 (dm6), issue p10: the /admin guide gate's heading ("You are guiding
 * Maria Lopez in this browser") broke the customer's name across two lines ("Maria / Lopez") at
 * the card's width. The name is one thing: it is rendered in its own `white-space: nowrap` span —
 * the text around the `{name}` slot comes from `tAround` — and the heading balances its lines.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

const i18n = () =>
  require("../../front-end/lib/i18n") as {
    tAround(lang: Any, key: string, slot: string, vars?: Any): [string, string];
    tFor(lang: Any, key: string, vars?: Any): string;
  };

describe("REQ-893 (dm6, p10) the gate heading keeps the customer's name on one line", () => {
  test("REQ-893 tAround: the text before and after one slot, in en and es; a missing slot leaves the text whole", () => {
    const { tAround, tFor } = i18n();
    const en = tAround("en", "adminGate.title", "name");
    expect(en).toEqual(["You are guiding ", " in this browser"]);
    const es = tAround("es", "adminGate.title", "name");
    expect(es).toEqual(["Estás guiando a ", " en este navegador"]);
    // the two halves around the name are the whole title
    expect(en[0] + "Maria Lopez" + en[1]).toBe(
      tFor("en", "adminGate.title", { name: "Maria Lopez" }),
    );
    // other vars still interpolate; a key without the slot: all before, nothing after
    expect(tAround("en", "adminGate.body", "name")).toEqual([
      tFor("en", "adminGate.body"),
      "",
    ]);
    // a name that looks like a slot is never re-interpolated
    expect(tAround("en", "adminGate.title", "name", { name: "{x}" })[0]).toBe(
      "You are guiding ",
    );
  });

  test("REQ-893 wiring: AdminGuideGate renders the name in a nowrap span around tAround's halves, on a balanced heading", () => {
    const gate = read("front-end/components/AdminGuideGate.tsx");
    expect(gate).toMatch(/tAround\(lang, "adminGate\.title", "name"\)/);
    expect(gate).toMatch(
      /<span[^>]*data-cy="admin-gate-name"[^>]*style="white-space:nowrap"[^>]*>\s*\{customer\}\s*<\/span>/,
    );
    const h1 = gate.slice(gate.indexOf("<h1"), gate.indexOf("</h1>"));
    expect(h1).toMatch(/text-wrap:balance/);
    expect(h1).not.toMatch(/tFor\(lang, "adminGate\.title"/);
  });
});
