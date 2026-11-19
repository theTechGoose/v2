/**
 * REQ-1001 (LOOP-007 cycle 1, QA issue q1-87) — on /worker, tapping a service's NAME
 * ("Lawn mowing") checks it off, not only the small 46px square. The element that runs
 * workerClient.complete/uncomplete must wrap `.svc__name`, carry data-cy="w-check", stay
 * disabled under the lock / preview / busy conditions, and the row shows a pointer cursor
 * (a default one when locked).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const screen = read("front-end/islands/WorkerScreen.tsx");
const css = (screen.match(/const css = `([\s\S]*?)`;/) ?? [])[1] ?? "";

/** Rules (selector → declarations) whose selector list has a selector matching `re`. */
function rules(re: RegExp): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (!sels.some((s) => re.test(s))) continue;
    const decl: Record<string, string> = {};
    for (const d of m[2].split(";")) {
      const [k, ...v] = d.split(":");
      if (k.trim()) decl[k.trim()] = v.join(":").trim();
    }
    out.push(decl);
  }
  return out;
}

/**
 * The JSX element whose onClick calls workerClient.complete — its tag name and the source from its opening tag to its matching close.
 */
function toggleElement() {
  const at = screen.indexOf("workerClient.complete(s.id)");
  if (at < 0) throw new Error("no workerClient.complete(s.id) call in WorkerScreen");
  // the opening tag that holds this onClick: the last "<tag" before it
  const before = screen.slice(0, at);
  const open = [...before.matchAll(/<([a-z]+)\b/g)].pop()!;
  const tag = open[1];
  const start = open.index!;
  // walk forward counting same-name opens/closes to find the matching close
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = start + 1;
  let depth = 1;
  let end = screen.length;
  for (let m = re.exec(screen); m; m = re.exec(screen)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      end = m.index + m[0].length;
      break;
    }
  }
  return { tag, body: screen.slice(start, end) };
}

describe("REQ-1001 (LOOP-007 q1, q1-87) the worker's service row checks off from its name", () => {
  test("REQ-1001: the element with the complete/uncomplete onClick wraps the service name (.svc__name)", () => {
    const { tag, body } = toggleElement();
    expect(body).toMatch(/workerClient\.uncomplete\(s\.id\)/);
    // today the handler is on a 46px <button class="svc__check"> that closes before the
    // name, so a tap on "Lawn mowing" does nothing
    expect({ tag, wrapsName: /class="svc__name"/.test(body) }).toEqual({
      tag,
      wrapsName: true,
    });
  });

  test("REQ-1001: the toggling row keeps data-cy=\"w-check\" and is disabled when locked, a preview or busy", () => {
    const { body } = toggleElement();
    expect(body).toMatch(/data-cy="w-check"/);
    expect(body).toMatch(/s\.locked/);
    expect(body).toMatch(/preview/);
    expect(body).toMatch(/busy\.has\(s\.id\)/);
    expect(body).toMatch(/class=\{`svc\$\{/);
  });

  test("REQ-1001: the .svc row shows a pointer cursor; a locked row a default one", () => {
    const row = rules(/^(button)?\.svc$/);
    expect(row.some((d) => d["cursor"] === "pointer")).toBe(true);
    const locked = rules(
      /^(button)?\.svc(\.svc--locked|--locked|\[disabled\]|:disabled)$/,
    );
    expect(locked.some((d) => d["cursor"] === "default")).toBe(true);
  });
});
